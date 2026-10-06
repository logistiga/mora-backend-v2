import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../database/prisma.service.js';
import { LlmService } from '../llm/llm.service.js';
import { NotificationService } from '../notifications/notification.service.js';
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
}

/** What the model returns on each turn (parsed and validated by parseTurn). */
export interface MissionTurn {
  reply: string;
  done: boolean;
  findings: Record<string, string>;
  report: string | null;
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
          { role: 'system', content: buildMissionPrompt(contact?.name ?? 'le contact', mission.objective, questions) },
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
      await this.finish(mission.id, 'completed', turn.report ?? buildReport(questions, findings), findings);
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

  /** Ends a mission, stores the report and tells the user. */
  private async finish(
    missionId: string,
    status: 'completed' | 'limit_reached' | 'error',
    notice?: string,
    findings?: Record<string, string>,
  ): Promise<void> {
    const mission = await this.prisma.whatsAppMission.findUnique({ where: { id: missionId } });
    if (!mission || mission.status !== 'active') return;

    const questions = Array.isArray(mission.questions) ? (mission.questions as string[]) : [];
    const storedFindings = findings ?? ((mission.findings as Record<string, string> | null) ?? {});
    const report = status === 'error' ? notice ?? 'Mission arrêtée.' : notice ?? buildReport(questions, storedFindings);

    await this.prisma.whatsAppMission.update({
      where: { id: missionId },
      data: { status: status === 'completed' ? 'done' : 'stopped', report, findings: storedFindings },
    });

    const contact = await this.prisma.contact.findUnique({ where: { id: mission.contactId }, select: { name: true } });
    const who = contact?.name ?? 'le contact';
    await this.notifications.create({
      userId: mission.userId,
      type: 'whatsapp_mission',
      title: status === 'completed' ? `Mission terminée : ${who}` : `Mission arrêtée : ${who}`,
      message: report,
      metadata: { missionId, status },
    });
    this.logger.log(`WhatsApp mission ${missionId} ended with status ${status}`);
  }
}

export function buildMissionPrompt(contactName: string, objective: string, questions: string[]): string {
  const list = questions.map((question, index) => `${index + 1}. ${question}`).join('\n');
  return [
    `Tu écris sur WhatsApp au nom de l'utilisateur à ${contactName}.`,
    `Objectif : ${objective}`,
    `Informations à obtenir :\n${list || '(aucune, juste atteindre l’objectif)'}`,
    'Règles : va droit au but, messages courts, une question à la fois, dans la langue du contact.',
    'Ne promets rien au nom de l’utilisateur, ne donne aucune information qu’on ne t’a pas demandée.',
    'Si le contact demande si tu es une IA, dis-le honnêtement.',
    'Termine (done=true) quand l’objectif est atteint ou si le contact refuse.',
    'Réponds UNIQUEMENT avec un objet JSON : {"reply": "prochain message à envoyer, vide si rien à dire", "done": false, "findings": {"question": "réponse obtenue"}, "report": null}. Si done=true, "report" est un compte rendu court en français.',
  ].join('\n');
}

/** Accepts the model's JSON (optionally in a code fence) and rejects anything that does not match the contract. */
export function parseTurn(content: string): MissionTurn | null {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as Partial<MissionTurn>;
    if (typeof parsed.done !== 'boolean') return null;
    const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
    const report = typeof parsed.report === 'string' && parsed.report.trim() ? parsed.report.trim() : null;
    const findings: Record<string, string> = {};
    if (parsed.findings && typeof parsed.findings === 'object') {
      for (const [key, value] of Object.entries(parsed.findings)) {
        if (typeof value === 'string' && value.trim()) findings[key] = value.trim();
      }
    }
    return { reply, done: parsed.done, findings, report };
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
