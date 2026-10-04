import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { WhatsAppMessageService } from './whatsapp-message.service.js';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller.js';
import { WhatsAppSendMessageTool } from '../tools/impl/whatsapp-send-message.tool.js';
import { WhatsAppSendDocumentTool } from '../tools/impl/whatsapp-send-document.tool.js';

function buildPrisma() {
  return {
    whatsAppConversation: {
      findUnique: vi.fn(async () => ({ id: 'c1', accountId: 'a1', scope: 'personal', space: 'personal', contactId: 'k1', account: { userId: 'u1' } })),
    },
    whatsAppMessage: {
      findFirst: vi.fn(async (): Promise<{ id: string; status: string | null } | null> => null),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      update: vi.fn(async () => ({})),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

function buildService(prisma: ReturnType<typeof buildPrisma>) {
  return new WhatsAppMessageService(prisma as never, {} as never, {} as never, { log: vi.fn() } as never, {} as never);
}

describe('WhatsAppMessageService: ownership', () => {
  it('refuses a conversation that belongs to another user, as not found', async () => {
    const service = buildService(buildPrisma());
    await expect(service.assertOwnedConversation('intruder', 'c1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('accepts a conversation the user owns', async () => {
    const service = buildService(buildPrisma());
    await expect(service.assertOwnedConversation('u1', 'c1')).resolves.toMatchObject({ id: 'c1' });
  });

  it('never reads another user message by id', async () => {
    const prisma = buildPrisma();
    const service = buildService(prisma);
    await expect(service.getMessageForUser('intruder', 'm1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.whatsAppMessage.findFirst).toHaveBeenCalledWith({
      where: { id: 'm1', conversation: { account: { userId: 'intruder' } } },
    });
  });
});

describe('WhatsAppMessageService: listing', () => {
  it('filters by owner, status and account, newest first, with pagination', async () => {
    const prisma = buildPrisma();
    const result = await buildService(prisma).listMessagesForUser('u1', { limit: 20, offset: 40, status: 'delivered', accountId: 'a1' });

    const call = (prisma.whatsAppMessage.findMany.mock.calls as unknown as Array<[{ where: unknown; orderBy: unknown; take: number; skip: number }]>)[0][0];
    expect(call.where).toEqual({ conversation: { account: { userId: 'u1', id: 'a1' } }, status: 'delivered' });
    expect(call.orderBy).toEqual({ timestamp: 'desc' });
    expect(call.take).toBe(20);
    expect(call.skip).toBe(40);
    expect(result).toEqual({ items: [], total: 0, limit: 20, offset: 40 });
  });

  it('defaults to 50 items from the start when no paging is given', async () => {
    const prisma = buildPrisma();
    await buildService(prisma).listMessagesForUser('u1', {});
    const call = (prisma.whatsAppMessage.findMany.mock.calls as unknown as Array<[{ take: number; skip: number }]>)[0][0];
    expect(call.take).toBe(50);
    expect(call.skip).toBe(0);
  });
});

describe('WhatsAppMessageService: delivery status', () => {
  it('advances an outbound message on a delivery receipt from its own account', async () => {
    const prisma = buildPrisma();
    prisma.whatsAppMessage.findFirst = vi.fn(async (): Promise<{ id: string; status: string | null } | null> => ({ id: 'm1', status: 'sent' }));
    const updated = await buildService(prisma).applyDeliveryStatus('a1', 'prov-1', 'DELIVERY_ACK');
    expect(updated).toBe(true);
    expect(prisma.whatsAppMessage.findFirst).toHaveBeenCalledWith({
      where: { providerMessageId: 'prov-1', direction: 'outbound', conversation: { accountId: 'a1' } },
    });
    expect(prisma.whatsAppMessage.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { status: 'delivered' } });
  });

  it('does nothing for an unknown message, an unmapped status, or a downgrade', async () => {
    const prisma = buildPrisma();
    const service = buildService(prisma);
    expect(await service.applyDeliveryStatus('a1', 'nope', 'READ')).toBe(false);

    prisma.whatsAppMessage.findFirst = vi.fn(async (): Promise<{ id: string; status: string | null } | null> => ({ id: 'm1', status: 'read' }));
    expect(await service.applyDeliveryStatus('a1', 'prov-1', 'DELIVERY_ACK')).toBe(false);
    expect(await service.applyDeliveryStatus('a1', 'prov-1', 'DELETED')).toBe(false);
    expect(prisma.whatsAppMessage.update).not.toHaveBeenCalled();
  });
});

describe('WhatsApp webhook: messages.update', () => {
  it('routes a status event to the status handler and never to inbound ingestion', async () => {
    const prisma = { whatsAppAccount: { findUnique: vi.fn(async () => ({ id: 'a1', userId: 'u1' })) } };
    const messageService = { applyDeliveryStatus: vi.fn(async () => true), ingestInbound: vi.fn() };
    const config = { get: vi.fn(() => undefined) };
    const controller = new WhatsAppWebhookController(prisma as never, messageService as never, config as never);

    const result = await controller.handle('a1', undefined, {
      event: 'messages.update',
      data: { keyId: 'prov-1', status: 'READ', remoteJid: '24162222111@s.whatsapp.net', fromMe: true },
    });

    expect(messageService.applyDeliveryStatus).toHaveBeenCalledWith('a1', 'prov-1', 'READ');
    expect(messageService.ingestInbound).not.toHaveBeenCalled();
    expect(result).toEqual({ received: true, processed: true, kind: 'status' });
  });
});

describe('WhatsApp send tools: direct send policy', () => {
  it('the text send tool runs without confirmation (N1, requiresConfirmation false)', () => {
    const tool = new WhatsAppSendMessageTool({} as never, {} as never);
    expect(tool.securityLevel).toBe('N1');
    expect(tool.requiresConfirmation).toBe(false);
  });

  it('the document send tool runs without confirmation (N1, requiresConfirmation false)', () => {
    const tool = new WhatsAppSendDocumentTool({} as never, {} as never, {} as never, {} as never, {} as never);
    expect(tool.securityLevel).toBe('N1');
    expect(tool.requiresConfirmation).toBe(false);
  });

  it('the text send tool refuses a conversation the user does not own, before any provider call', async () => {
    const prisma = buildPrisma();
    const messageService = {
      assertOwnedConversation: vi.fn(async () => { throw new NotFoundException(); }),
      sendAndPersist: vi.fn(),
    };
    const tool = new WhatsAppSendMessageTool(prisma as never, messageService as never);
    const result = await tool.execute(
      { userId: 'intruder', scope: 'personal', space: 'personal', route: 'personal' },
      { conversationId: '00000000-0000-4000-8000-000000000001', text: 'salut' },
    );
    expect(result).toEqual({ ok: false, errorCode: 'not_found' });
    expect(messageService.sendAndPersist).not.toHaveBeenCalled();
  });
});
