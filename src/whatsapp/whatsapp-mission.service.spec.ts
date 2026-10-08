import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppMissionService, buildReport, parseTurn } from './whatsapp-mission.service.js';

function activeMission(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mis-1',
    userId: 'u1',
    contactId: 'c1',
    conversationId: 'conv-1',
    objective: 'Prendre un rendez-vous',
    questions: ['Quelle date ?', 'Quelle heure ?'],
    status: 'active',
    messagesSent: 1,
    maxMessages: 10,
    deadlineAt: new Date(Date.now() + 60_000),
    findings: {},
    scope: 'personal',
    space: 'personal',
    ...overrides,
  };
}

describe('parseTurn', () => {
  it('accepts a plain JSON turn', () => {
    expect(parseTurn('{"reply":"Bonjour","done":false,"findings":{},"report":null}')).toEqual({
      reply: 'Bonjour',
      done: false,
      findings: {},
      report: null,
      confirmedAt: null,
    });
  });

  it('accepts a turn wrapped in a code fence', () => {
    expect(parseTurn('```json\n{"reply":"","done":true,"findings":{"Quelle date ?":"lundi"},"report":"RDV lundi"}\n```')).toMatchObject({
      done: true,
      findings: { 'Quelle date ?': 'lundi' },
      report: 'RDV lundi',
    });
  });

  it('rejects output without a boolean done flag or that is not JSON', () => {
    expect(parseTurn('{"reply":"Bonjour"}')).toBeNull();
    expect(parseTurn('désolé, je ne peux pas')).toBeNull();
  });

  it('drops findings with non-string or empty values', () => {
    expect(parseTurn('{"reply":"","done":false,"findings":{"a":"ok","b":3,"c":"  "}}')?.findings).toEqual({ a: 'ok' });
  });
});

describe('buildReport', () => {
  it('lists each question with its answer, or "non obtenu"', () => {
    expect(buildReport(['Quelle date ?', 'Quelle heure ?'], { 'Quelle date ?': 'lundi' })).toBe(
      '• Quelle date ? — lundi\n• Quelle heure ? — non obtenu',
    );
  });
});

describe('WhatsAppMissionService.runTurn', () => {
  let prisma: {
    whatsAppMission: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
    whatsAppMessage: { findMany: ReturnType<typeof vi.fn> };
    contact: { findUnique: ReturnType<typeof vi.fn> };
  };
  let messageService: { sendAndPersist: ReturnType<typeof vi.fn>; openConversationForContact: ReturnType<typeof vi.fn> };
  let llm: { complete: ReturnType<typeof vi.fn> };
  let notifications: { create: ReturnType<typeof vi.fn> };
  let reminders: { create: ReturnType<typeof vi.fn> };
  let timeContext: { describeNow: ReturnType<typeof vi.fn> };
  let service: WhatsAppMissionService;

  beforeEach(() => {
    prisma = {
      whatsAppMission: {
        findFirst: vi.fn(async () => activeMission()),
        update: vi.fn(async () => ({})),
        findUnique: vi.fn(async () => activeMission()),
      },
      whatsAppMessage: { findMany: vi.fn(async () => [{ direction: 'inbound', text: 'Oui, bonjour' }]) },
      contact: { findUnique: vi.fn(async () => ({ name: 'Mustapha' })) },
    };
    messageService = {
      sendAndPersist: vi.fn(async () => ({ id: 'm-out' })),
      openConversationForContact: vi.fn(async () => 'conv-1'),
    };
    llm = { complete: vi.fn(async () => ({ configured: true, content: '{"reply":"Quel jour ?","done":false,"findings":{}}' })) };
    notifications = { create: vi.fn(async () => ({})) };
    reminders = { create: vi.fn(async () => ({ id: 'rem-1' })) };
    timeContext = { describeNow: vi.fn(() => "Nous sommes le 2026-10-08T12:00:00.000Z.") };
    const queue = { add: vi.fn() };
    service = new WhatsAppMissionService(
      prisma as never,
      messageService as never,
      llm as never,
      notifications as never,
      reminders as never,
      timeContext as never,
      queue as never,
    );
  });

  it('sends the next message and counts it when the objective is not reached', async () => {
    await service.runTurn('conv-1');

    expect(messageService.sendAndPersist).toHaveBeenCalledWith('u1', 'conv-1', 'Quel jour ?');
    expect(prisma.whatsAppMission.update).toHaveBeenCalledWith({
      where: { id: 'mis-1' },
      data: { messagesSent: 2, findings: {} },
    });
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('completes the mission and notifies the user with the report when done', async () => {
    llm.complete.mockResolvedValue({
      configured: true,
      content: '{"reply":"Merci, à lundi !","done":true,"findings":{"Quelle date ?":"lundi"},"report":"RDV lundi, heure à confirmer."}',
    });
    prisma.whatsAppMission.findFirst.mockResolvedValue(activeMission());
    prisma.whatsAppMission.findUnique.mockResolvedValue(activeMission());

    await service.runTurn('conv-1');

    expect(messageService.sendAndPersist).toHaveBeenCalledWith('u1', 'conv-1', 'Merci, à lundi !');
    expect(prisma.whatsAppMission.update).toHaveBeenCalledWith({
      where: { id: 'mis-1' },
      data: { status: 'done', report: 'RDV lundi, heure à confirmer.', findings: { 'Quelle date ?': 'lundi' } },
    });
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', type: 'whatsapp_mission' }));
  });

  it('auto-creates a reminder when the contact confirmed an exact future date/time', async () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    llm.complete.mockResolvedValue({
      configured: true,
      content: JSON.stringify({
        reply: 'Parfait, à bientôt !',
        done: true,
        findings: { 'Quelle date ?': 'lundi 14h' },
        report: 'RDV confirmé.',
        confirmedAt: future,
      }),
    });

    await service.runTurn('conv-1');

    expect(reminders.create).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ scope: 'personal', space: 'personal', title: 'RDV avec Mustapha', remindAt: future }),
      'tool',
      'conv-1',
    );
    expect(prisma.whatsAppMission.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reminderId: 'rem-1' }) }),
    );
  });

  it('does not create a reminder when confirmedAt is missing, in the past, or unparsable', async () => {
    llm.complete.mockResolvedValue({
      configured: true,
      content: '{"reply":"Merci !","done":true,"findings":{},"report":"RDV à préciser.","confirmedAt":"pas une date"}',
    });

    await service.runTurn('conv-1');

    expect(reminders.create).not.toHaveBeenCalled();
  });

  it('stops at the message limit without asking the model again', async () => {
    prisma.whatsAppMission.findFirst.mockResolvedValue(activeMission({ messagesSent: 10 }));
    prisma.whatsAppMission.findUnique.mockResolvedValue(activeMission({ messagesSent: 10 }));

    await service.runTurn('conv-1');

    expect(llm.complete).not.toHaveBeenCalled();
    expect(messageService.sendAndPersist).not.toHaveBeenCalled();
    expect(prisma.whatsAppMission.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'stopped' }) }));
  });

  it('stops the mission when no AI provider is configured, sending nothing', async () => {
    llm.complete.mockResolvedValue({ configured: false, content: '' });

    await service.runTurn('conv-1');

    expect(messageService.sendAndPersist).not.toHaveBeenCalled();
    expect(prisma.whatsAppMission.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'stopped' }) }));
    expect(notifications.create).toHaveBeenCalled();
  });

  it('does nothing when no mission is running on the conversation', async () => {
    prisma.whatsAppMission.findFirst.mockResolvedValue(null);

    await service.runTurn('conv-1');

    expect(llm.complete).not.toHaveBeenCalled();
    expect(messageService.sendAndPersist).not.toHaveBeenCalled();
  });
});
