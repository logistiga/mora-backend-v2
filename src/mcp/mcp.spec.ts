import { describe, expect, it, vi } from 'vitest';
import { McpController } from './mcp.controller.js';
import { McpService } from './mcp.service.js';

function buildServices() {
  const prisma = {
    whatsAppAccount: { findMany: vi.fn(async () => [{ id: 'acc-1' }]) },
  };
  const messages = {
    listConversations: vi.fn(async () => [{ id: 'c1' }]),
    assertOwnedConversation: vi.fn(async () => ({ id: 'c1' })),
    readMessages: vi.fn(async () => []),
    sendTextForUser: vi.fn(async () => ({ id: 'm1', status: 'sent' })),
    getMessageForUser: vi.fn(async () => ({ id: 'm1', status: 'read' })),
  };
  const service = new McpService(prisma as never, messages as never);
  return { service, prisma, messages };
}

function fakeRes() {
  return { statusCode: 200 as number, status(code: number) { this.statusCode = code; return this; } };
}

const user = { id: 'u1', email: 'o@x.com', role: 'ADMIN' };

describe('MCP endpoint (JSON-RPC over HTTP)', () => {
  it('answers initialize with the protocol version and tools capability', async () => {
    const { service } = buildServices();
    const res = fakeRes();
    const body = await new McpController(service).handle(user, { jsonrpc: '2.0', id: 1, method: 'initialize' }, res as never);
    expect(body).toMatchObject({ jsonrpc: '2.0', id: 1, result: { capabilities: { tools: {} } } });
  });

  it('lists exactly the four WhatsApp tools', async () => {
    const { service } = buildServices();
    const res = fakeRes();
    const body = await new McpController(service).handle(user, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, res as never);
    const names = (body as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name);
    expect(names).toEqual(['whatsapp_list_conversations', 'whatsapp_get_messages', 'whatsapp_send_message', 'whatsapp_get_message_status']);
  });

  it('answers a notification with 202 and no body', async () => {
    const { service } = buildServices();
    const res = fakeRes();
    const body = await new McpController(service).handle(user, { jsonrpc: '2.0', method: 'notifications/initialized' }, res as never);
    expect(res.statusCode).toBe(202);
  });

  it('refuses to send unless confirm is true, before any provider call', async () => {
    const { service, messages } = buildServices();
    const res = fakeRes();
    const body = await new McpController(service).handle(
      user,
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'whatsapp_send_message', arguments: { conversationId: 'c1', text: 'x', confirm: false } } },
      res as never,
    );
    expect(body).toMatchObject({ result: { isError: true } });
    expect(messages.sendTextForUser).not.toHaveBeenCalled();
  });

  it('sends only when confirm is true, through the owner-checked service path', async () => {
    const { service, messages } = buildServices();
    const res = fakeRes();
    const body = await new McpController(service).handle(
      user,
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'whatsapp_send_message', arguments: { conversationId: 'c1', text: 'bonjour', confirm: true } } },
      res as never,
    );
    expect(messages.sendTextForUser).toHaveBeenCalledWith('u1', 'c1', 'bonjour');
  });

  it('lists conversations only across the calling user accounts', async () => {
    const { service, prisma, messages } = buildServices();
    const res = fakeRes();
    const body = await new McpController(service).handle(
      user,
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'whatsapp_list_conversations', arguments: {} } },
      res as never,
    );
    expect(prisma.whatsAppAccount.findMany).toHaveBeenCalledWith({ where: { userId: 'u1' }, select: { id: true } });
    expect(messages.listConversations).toHaveBeenCalledWith(['acc-1']);
  });

  it('checks ownership before reading a conversation', async () => {
    const { service, messages } = buildServices();
    messages.assertOwnedConversation.mockRejectedValueOnce(new Error('Conversation not found'));
    const res = fakeRes();
    const body = await new McpController(service).handle(
      user,
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'whatsapp_get_messages', arguments: { conversationId: 'other' } } },
      res as never,
    );
    expect(body).toMatchObject({ result: { isError: true, content: [{ text: 'Conversation not found' }] } });
    expect(messages.readMessages).not.toHaveBeenCalled();
  });

  it('returns a protocol error for an unknown method or tool', async () => {
    const { service } = buildServices();
    const res = fakeRes();
    const body = await new McpController(service).handle(user, { jsonrpc: '2.0', id: 7, method: 'nope' }, res as never);
    expect(body).toMatchObject({ error: { code: -32601 } });
    const body2 = await new McpController(service).handle(user, { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'nope' } }, fakeRes() as never);
    expect(body2).toMatchObject({ error: { code: -32602 } });
  });
});
