import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailMessageService } from './email-message.service.js';

function buildService() {
  const prisma = {
    emailMessage: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'msg-1', ...args.data })),
    },
    emailThread: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'thread-1', scope: 'professional', space: 'general' })),
      update: vi.fn(async () => ({})),
    },
  };
  const contactService = {
    findByIdentity: vi.fn(async () => ({ id: 'contact-1', trustLevel: 'known' })),
    create: vi.fn(async () => ({ id: 'contact-1', trustLevel: 'known' })),
    addIdentity: vi.fn(async () => ({})),
    touchLastInteraction: vi.fn(async () => undefined),
  };
  const accountService = { resolveConnection: vi.fn(async () => ({})), updateHealth: vi.fn(async () => undefined) };
  const auditService = { log: vi.fn(async () => undefined) };
  const memoryExtraction = {
    proposeCandidatesFromDocument: vi.fn(async () => [] as Array<{ kind: string; content: string; importance: number; confidence: number }>),
    commitCandidates: vi.fn(async () => undefined),
  };
  const provider = { fetchRecent: vi.fn(async () => []), send: vi.fn() };

  const service = new EmailMessageService(
    prisma as never,
    contactService as never,
    accountService as never,
    auditService as never,
    memoryExtraction as never,
    provider as never,
  );

  return { service, prisma, contactService, accountService, auditService, memoryExtraction, provider };
}

const email = {
  providerMessageId: 'prov-1',
  from: 'client@example.com',
  to: ['omar@logistiga.com'],
  cc: [],
  subject: 'Facture en attente',
  textBody: 'Merci de régler la facture avant le 15.',
  receivedAt: new Date('2026-10-07T10:00:00Z'),
};

describe('EmailMessageService — memory extraction on inbound mail', () => {
  let ctx: ReturnType<typeof buildService>;
  beforeEach(() => {
    ctx = buildService();
  });

  it('reads the new e-mail for durable facts and commits them with source "document"', async () => {
    ctx.memoryExtraction.proposeCandidatesFromDocument.mockResolvedValue([
      { kind: 'fact', content: 'Facture à régler avant le 15 octobre', importance: 0.7, confidence: 0.7 },
    ]);

    await (ctx.service as unknown as { ingestOne: (u: string, a: string, e: typeof email) => Promise<unknown> }).ingestOne(
      'u1', 'acc1', email,
    );

    expect(ctx.memoryExtraction.proposeCandidatesFromDocument).toHaveBeenCalledWith(
      expect.stringContaining('Merci de régler la facture'),
      expect.objectContaining({ userId: 'u1', scope: 'professional', space: 'general', filename: expect.stringContaining('Facture en attente') }),
    );
    expect(ctx.memoryExtraction.commitCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', scope: 'professional', space: 'general', source: 'document' }),
    );
  });

  it('never fails ingestion when extraction throws', async () => {
    ctx.memoryExtraction.proposeCandidatesFromDocument.mockRejectedValue(new Error('LLM down'));

    const result = await (ctx.service as unknown as { ingestOne: (u: string, a: string, e: typeof email) => Promise<unknown> }).ingestOne(
      'u1', 'acc1', email,
    );

    expect(result).toMatchObject({ id: 'msg-1' });
  });

  it('does nothing when no candidate is worth keeping', async () => {
    ctx.memoryExtraction.proposeCandidatesFromDocument.mockResolvedValue([]);

    await (ctx.service as unknown as { ingestOne: (u: string, a: string, e: typeof email) => Promise<unknown> }).ingestOne(
      'u1', 'acc1', email,
    );

    expect(ctx.memoryExtraction.commitCandidates).not.toHaveBeenCalled();
  });
});
