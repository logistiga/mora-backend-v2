import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppMessageService } from './whatsapp-message.service.js';

function buildService() {
  const prismaMock = {
    whatsAppMessage: { findUnique: vi.fn(), create: vi.fn() },
    whatsAppConversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  };
  const contactServiceMock = {
    findByIdentity: vi.fn(),
    create: vi.fn(),
    addIdentity: vi.fn(),
    touchLastInteraction: vi.fn(),
  };
  const accountServiceMock = { resolveConnection: vi.fn() };
  const auditServiceMock = { log: vi.fn() };
  const providerMock = { sendTextMessage: vi.fn() };

  const service = new WhatsAppMessageService(
    prismaMock as never,
    contactServiceMock as never,
    accountServiceMock as never,
    auditServiceMock as never,
    providerMock as never,
  );
  return { service, prismaMock, contactServiceMock, auditServiceMock };
}

describe('WhatsAppMessageService — inbound idempotence & trust', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('ingestInbound() is a no-op for a duplicate providerMessageId (AGENTS §26/§27)', async () => {
    ctx.prismaMock.whatsAppMessage.findUnique.mockResolvedValue({ id: 'existing' });

    const result = await ctx.service.ingestInbound('u1', {
      accountId: 'a1',
      providerMessageId: 'dup-1',
      fromNumber: '+33600000000',
      timestamp: new Date(),
    });

    expect(result).toBeNull();
    expect(ctx.prismaMock.whatsAppMessage.create).not.toHaveBeenCalled();
    expect(ctx.contactServiceMock.findByIdentity).not.toHaveBeenCalled();
  });

  it('ingestInbound() never stores a message from a blocked contact', async () => {
    ctx.prismaMock.whatsAppMessage.findUnique.mockResolvedValue(null);
    ctx.contactServiceMock.findByIdentity.mockResolvedValue({ id: 'c1', trustLevel: 'blocked' });

    const result = await ctx.service.ingestInbound('u1', {
      accountId: 'a1',
      providerMessageId: 'msg-1',
      fromNumber: '+33600000000',
      timestamp: new Date(),
    });

    expect(result).toBeNull();
    expect(ctx.prismaMock.whatsAppMessage.create).not.toHaveBeenCalled();
    expect(ctx.auditServiceMock.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'whatsapp_message_blocked_contact' }));
  });

  it('ingestInbound() creates a new unknown-trust contact for a first-time sender', async () => {
    ctx.prismaMock.whatsAppMessage.findUnique.mockResolvedValue(null);
    ctx.contactServiceMock.findByIdentity.mockResolvedValue(null);
    ctx.contactServiceMock.create.mockResolvedValue({ id: 'c-new', trustLevel: 'unknown' });
    ctx.prismaMock.whatsAppConversation.findFirst.mockResolvedValue(null);
    ctx.prismaMock.whatsAppConversation.create.mockResolvedValue({ id: 'conv-1' });
    ctx.prismaMock.whatsAppMessage.create.mockResolvedValue({ id: 'm1' });

    await ctx.service.ingestInbound('u1', {
      accountId: 'a1',
      providerMessageId: 'msg-2',
      fromNumber: '+33611111111',
      timestamp: new Date(),
    });

    expect(ctx.contactServiceMock.create).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ trustLevel: 'unknown' }),
    );
    expect(ctx.prismaMock.whatsAppMessage.create).toHaveBeenCalledOnce();
  });

  it('ingestInbound() reuses an existing conversation for a known contact rather than creating a duplicate', async () => {
    ctx.prismaMock.whatsAppMessage.findUnique.mockResolvedValue(null);
    ctx.contactServiceMock.findByIdentity.mockResolvedValue({ id: 'c1', trustLevel: 'known' });
    ctx.prismaMock.whatsAppConversation.findFirst.mockResolvedValue({ id: 'existing-conv' });
    ctx.prismaMock.whatsAppMessage.create.mockResolvedValue({ id: 'm1' });

    await ctx.service.ingestInbound('u1', {
      accountId: 'a1',
      providerMessageId: 'msg-3',
      fromNumber: '+33622222222',
      timestamp: new Date(),
    });

    expect(ctx.prismaMock.whatsAppConversation.create).not.toHaveBeenCalled();
    expect(ctx.prismaMock.whatsAppMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ conversationId: 'existing-conv' }) }),
    );
  });
});
