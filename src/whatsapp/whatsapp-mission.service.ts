import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../database/prisma.service.js';
import { TimeContextService } from '../common/time/time-context.service.js';
import { LlmService } from '../llm/llm.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { ReminderService } from '../reminders/reminder.service.js';
import { WhatsAppMessageService } from './whatsapp-message.service.js';
import { WHATSAPP_MISSION_QUEUE, MISSION_TURN_JOB } from './whatsapp-mission.constants.js';

/** A mission stops after this many messages from Mora, whatever happens. */
export const MISSION_MAX_MESSAGES = 10;
/** ...or after this long, even if the contact is silent. */
export const MISSION_TTL_MS = 48 * 60 * 60 * 1000;
/** How much of the conversation the model sees on each turn. */
const HISTORY_LIMIT = 20;

export interface StartMissionInput {
  userId: string;
  contactId: string;
  contactName: string;
  objective: string;
  questions: string[];
  openingMessage: string;
  scope: 'personal' | 'professional';
  space: string;
}

/** What the model returns on each turn (parsed and validated by parseTurn). */
export interface MissionTurn {
  reply: string;
  done: boolean;
  findings: Record<string, string>;
  report: string | null;
  /** ISO 8601 datetime, only once both sides agreed on an exact date+time; null otherwise. */
  confirmedAt: string | null;
}

/**
 * Runs goal-driven WhatsApp conversations. Mora writes on the user's behalf,
 * one turn per inbound reply, and ends with a report sent to the user's
 * notifications. The first message only goes out after the user confirms the
 * start_mission tool call (see WhatsAppStartMissionTool).
 */
@Injectable()
export class WhatsAppMissionService {
  private readonly logger = new Logger(WhatsAppMissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messageService: WhatsAppMessageService,
    private readonly llm: LlmService,
    private readonly notifications: NotificationService,
    private readonly reminders: ReminderService,
    private readonly timeContext: TimeContextService,
    @InjectQueue(WHATSAPP_MISSION_QUEUE) private readonly queue: Queue,
  ) {}

  /** Sends the opening message and records the mission. Refuses a second mission on the same contact. */
  async start(input: StartMissionInput): Promise<{ missionId: string; messageId: string }> {
    const conversationId = await this.messageService.openConversationForContact(input.userId, input.contactId);
    const running = await this.prisma.whatsAppMission.findFirst({ where: { conversationId, status: 'active' }, select: { id: true } });
    if (running) throw new Error('Une mission est déjà en cours avec ce contact.');

    const sent = await this.messageService.sendAndPersist(input.userId, conversationId, input.openingMessage);
    const mission = await this.prisma.whatsAppMission.create({
      data: {
        userId: input.userId,
        contactId: input.contactId,
        conversationId,
        objective: input.objective,
        questions: input.questions,
        openingMessage: input.openingMessage,
        status: 'active',
        messagesSent: 1,
        maxMessages: MISSION_MAX_MESSAGES,
        deadlineAt: new Date(Date.now() + MISSION_TTL_MS),
        findings: {},
        scope: input.scope,
        space: input.space,
      },
    });
    return { missionId: mission.id, messageId: sent.id };
  }

  /** Called for every inbound WhatsApp message: queues a turn if a mission is running on that conversation. */
  async onInbound(conversationId: string): Promise<void> {
    const running = await this.prisma.whatsAppMission.findFirst({ where: { conversationId, status: 'active' }, select: { id: true } });
    if (!running) return;
    await this.queue.add(MISSION_TURN_JOB, { conversationId }, { attempts: 2, backoff: { type: 'fixed', delay: 5000 }, removeOnComplete: true });
  }

  /** One turn: read the latest state, ask the model what to say, send it, or conclude. */
  async runTurn(conversationId: string): Promise<void> {
    const mission = await this.prisma.whatsAppMission.findFirst({ where: { conversationId, status: 'active' } });
    if (!mission) return;
    if (mission.deadlineAt.getTime() < Date.now() || mission.messagesSent >= mission.maxMessages) {
      await this.finish(mission.id, 'limit_reached');
      return;
    }

    const history = await this.prisma.whatsAppMessage.findMany({
      where: { conversationId },
      orderBy: { timestamp: 'desc' },
      take: HISTORY_LIMIT,
    });
    const contact = await this.prisma.contact.findUnique({ where: { id: mission.contactId }, select: { name: true } });
    const questions = Array.isArray(mission.questions) ? (mission.questions as string[]) : [];

    const response = await this.llm.complete(
      {
        messages: [
          {
            role: 'system',
            content: buildMissionPrompt(
              contact?.name ?? 'le contact',
              mission.objective,
              questions,
              this.timeContext.describeNow(),
            ),
          },
          ...history.reverse().map((message) => ({
            role: message.direction === 'inbound' ? ('user' as const) : ('assistant' as const),
            content: message.text ?? '',
          })),
        ],
        temperature: 0.3,
        maxTokens: 500,
      },
      { userId: mission.userId, route: 'whatsapp-mission' },
    );
    if (!response.configured) {
      await this.finish(mission.id, 'error', 'Aucun fournisseur IA configuré : la mission a été arrêtée.');
      return;
    }

    const turn = parseTurn(response.content);
    if (!turn) {
      await this.finish(mission.id, 'error', 'La réponse de l’IA était illisible : la mission a été arrêtée.');
      return;
    }

    const findings = { ...((mission.findings as Record<string, string> | null) ?? {}), ...turn.findings };
    if (turn.done) {
      if (turn.reply) await this.messageService.sendAndPersist(mission.userId, conversationId, turn.reply);
      await this.finish(mission.id, 'completed', turn.report ?? buildReport(questions, findings), findings, turn.confirmedAt);
      return;
    }

    if (turn.reply) {
      await this.messageService.sendAndPersist(mission.userId, conversationId, turn.reply);
    }
    const messagesSent = mission.messagesSent + (turn.reply ? 1 : 0);
    await this.prisma.whatsAppMission.update({ where: { id: mission.id }, data: { messagesSent, findings } });
    if (messagesSent >= mission.maxMessages) {
      await this.finish(mission.id, 'limit_reached', undefined, findings);
    }
  }

  /** Periodic sweep: ends missions whose deadline has passed even when the contact stays silent. */
  async sweep(): Promise<void> {
    const overdue = await this.prisma.whatsAppMission.findMany({
      where: { status: 'active', deadlineAt: { lt: new Date() } },
      select: { id: true },
    });
    for (const { id } of overdue) {
      await this.finish(id, 'limit_reached');
    }
  }

  /** Ends a mission, stores the report, auto-books a confirmed date as a reminder, and tells the user. */
  private async finish(
    missionId: string,
    status: 'completed' | 'limit_reached' | 'error',
    notice?: string,
    findings?: Record<string, string>,
    confirmedAt?: string | null,
  ): Promise<void> {
    const mission = await this.prisma.whatsAppMission.findUnique({ where: { id: missionId } });
    if (!mission || mission.status !== 'active') return;

    const questions = Array.isArray(mission.questions) ? (mission.questions as string[]) : [];
    const storedFindings = findings ?? ((mission.findings as Record<string, string> | null) ?? {});
    let report = status === 'error' ? notice ?? 'Mission arrêtée.' : notice ?? buildReport(questions, storedFindings);

    const contact = await this.prisma.contact.findUnique({ where: { id: mission.contactId }, select: { name: true } });
    const who = contact?.name ?? 'le contact';

    // Close the loop: a negotiated appointment becomes an actual reminder,
    // not just a text report the user has to act on themselves. Only when
    // the model gave a real, parseable future date — never guess one.
    let reminderId: string | null = null;
    const parsedConfirmedAt = confirmedAt ? new Date(confirmedAt) : null;
    if (status === 'completed' && parsedConfirmedAt && !Number.isNaN(parsedConfirmedAt.getTime()) && parsedConfirmedAt.getTime() > Date.now()) {
      try {
        const reminder = await this.reminders.create(
          mission.userId,
          {
            scope: mission.scope as 'personal' | 'professional',
            space: mission.space,
            title: `RDV avec ${who}`,
            message: mission.objective,
            remindAt: parsedConfirmedAt.toISOString(),
          },
          'tool',
          mission.conversationId,
        );
        reminderId = reminder.id;
        report += `\n\nAjouté à vos rappels pour le ${parsedConfirmedAt.toLocaleString('fr-FR')}.`;
      } catch (error) {
        this.logger.warn(`Could not auto-create a reminder for mission ${missionId}: ${String(error)}`);
      }
    }

    await this.prisma.whatsAppMission.update({
      where: { id: missionId },
      data: {
        status: status === 'completed' ? 'done' : 'stopped',
        report,
        findings: storedFindings,
        confirmedAt: parsedConfirmedAt && !Number.isNaN(parsedConfirmedAt.getTime()) ? parsedConfirmedAt : undefined,
        reminderId: reminderId ?? undefined,
      },
    });

    await this.notifications.create({
      userId: mission.userId,
      type: 'whatsapp_mission',
      title: status === 'completed' ? `Mission terminée : ${who}` : `Mission arrêtée : ${who}`,
      message: report,
      metadata: { missionId, status, reminderId },
    });
    this.logger.log(`WhatsApp mission ${missionId} ended with status ${status}${reminderId ? `, reminder=${reminderId}` : ''}`);
  }
}

export function buildMissionPrompt(
  contactName: string,
  objective: string,
  questions: string[],
  timeContext?: string,
): string {
  const list = questions.map((question, index) => `${index + 1}. ${question}`).join('\n');
  return [
    `Tu écris sur WhatsApp au nom de l'utilisateur à ${contactName}.`,
    `Objectif : ${objective}`,
    `Informations à obtenir :\n${list || '(aucune, juste atteindre l’objectif)'}`,
    timeContext ? `${timeContext} Résous toute date relative ("lundi", "demain", "dans 2 jours") par rapport à cette référence.` : '',
    'Règles : va droit au but, messages courts, une question à la fois, dans la langue du contact.',
    'Ne promets rien au nom de l’utilisateur, ne donne aucune information qu’on ne t’a pas demandée.',
    'Si le contact demande si tu es une IA, dis-le honnêtement.',
    "Reste en contact jusqu'à ce que l'objectif soit vraiment atteint (ex. une date ET une heure précises acceptées par le contact) ou que le contact refuse explicitement — ne termine jamais juste parce que le contact a répondu une fois.",
    'Termine (done=true) quand l’objectif est atteint ou si le contact refuse.',
    "Si l'objectif est de fixer un rendez-vous et que le contact a confirmé une date ET une heure précises (pas une proposition encore ouverte), mets cette date dans \"confirmedAt\" au format ISO 8601 complet (ex. \"2026-10-13T14:00:00\"). Laisse \"confirmedAt\" à null dans tous les autres cas, y compris si la date reste approximative ou non confirmée par le contact.",
    'Réponds UNIQUEMENT avec un objet JSON : {"reply": "prochain message à envoyer, vide si rien à dire", "done": false, "findings": {"question": "réponse obtenue"}, "report": null, "confirmedAt": null}. Si done=true, "report" est un compte rendu court en français.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Accepts the model's JSON (optionally in a code fence) and rejects anything that does not match the contract. */
export function parseTurn(content: string): MissionTurn | null {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as Partial<MissionTurn>;
    if (typeof parsed.done !== 'boolean') return null;
    const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
    const report = typeof parsed.report === 'string' && parsed.report.trim() ? parsed.report.trim() : null;
    const confirmedAt = typeof parsed.confirmedAt === 'string' && parsed.confirmedAt.trim() ? parsed.confirmedAt.trim() : null;
    const findings: Record<string, string> = {};
    if (parsed.findings && typeof parsed.findings === 'object') {
      for (const [key, value] of Object.entries(parsed.findings)) {
        if (typeof value === 'string' && value.trim()) findings[key] = value.trim();
      }
    }
    return { reply, done: parsed.done, findings, report, confirmedAt };
  } catch {
    return null;
  }
}

/** Fallback report when the model did not write one: what was asked and what was obtained. */
export function buildReport(questions: string[], findings: Record<string, string>): string {
  if (questions.length === 0) return 'Mission terminée.';
  return questions
    .map((question) => `• ${question} — ${findings[question] ?? 'non obtenu'}`)
    .join('\n');
}
