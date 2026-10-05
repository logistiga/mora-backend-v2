#!/usr/bin/env node
// MCP server (stdio) exposing Mora v2 WhatsApp tools to Claude Code.
// No network listener: Claude Code starts it locally and talks over stdin/stdout.
// Credentials come only from environment variables, never from this file.
//
// Env:
//   MORA_API_URL   default https://mora-v2-staging.logistiga.tech/api/v1
//   MORA_API_KEY   personal Mora API key (mora_…), sent as the X-Api-Key header

const API = process.env.MORA_API_URL || 'https://mora-v2-staging.logistiga.tech/api/v1';
const PROTOCOL = '2024-11-05';

function apiKey() {
  const key = process.env.MORA_API_KEY;
  if (!key) throw new Error('MORA_API_KEY must be set in the environment');
  return key;
}

async function mora(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'X-Api-Key': apiKey(), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${data?.message ?? res.statusText}`);
  return data;
}

const uuid = { type: 'string', description: 'UUID' };

const TOOLS = [
  {
    name: 'whatsapp_list_conversations',
    description: 'Liste les conversations WhatsApp de Mora (les plus récentes en premier).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => mora('/whatsapp/conversations'),
  },
  {
    name: 'whatsapp_get_messages',
    description: "Lit les derniers messages d'une conversation WhatsApp.",
    inputSchema: {
      type: 'object',
      properties: { conversationId: uuid, limit: { type: 'integer', minimum: 1, maximum: 200 } },
      required: ['conversationId'],
      additionalProperties: false,
    },
    run: async ({ conversationId, limit = 50 }) =>
      mora(`/whatsapp/conversations/${encodeURIComponent(conversationId)}/messages?limit=${limit}`),
  },
  {
    name: 'whatsapp_send_message',
    description:
      "Envoie un message WhatsApp directement via Mora. Ne l'appelle qu'après que l'utilisateur a confirmé le destinataire et le texte dans la conversation : `confirm` doit valoir true.",
    inputSchema: {
      type: 'object',
      properties: {
        conversationId: uuid,
        text: { type: 'string', minLength: 1, maxLength: 4000 },
        confirm: { type: 'boolean', description: "Doit être true : l'utilisateur a validé l'envoi" },
      },
      required: ['conversationId', 'text', 'confirm'],
      additionalProperties: false,
    },
    run: async ({ conversationId, text, confirm }) => {
      if (confirm !== true) throw new Error('Envoi refusé : confirmation utilisateur absente (confirm=true requis).');
      return mora('/whatsapp/messages', { method: 'POST', body: { conversationId, text } });
    },
  },
  {
    name: 'whatsapp_get_message_status',
    description: "Donne le statut d'un message envoyé (sent, delivered, read, failed).",
    inputSchema: {
      type: 'object',
      properties: { messageId: uuid },
      required: ['messageId'],
      additionalProperties: false,
    },
    run: async ({ messageId }) => mora(`/whatsapp/messages/${encodeURIComponent(messageId)}`),
  },
];

function publicTool({ name, description, inputSchema }) {
  return { name, description, inputSchema };
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined;

  if (method === 'notifications/initialized') return;

  if (!isRequest) return;

  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: { name: 'mora-whatsapp', version: '1.0.0' },
    });
  }
  if (method === 'tools/list') {
    return reply(id, { tools: TOOLS.map(publicTool) });
  }
  if (method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) return replyError(id, -32602, `Unknown tool: ${params?.name}`);
    try {
      const data = await tool.run(params.arguments ?? {});
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
    } catch (err) {
      // Errors are returned to the model as tool errors, never as stack traces.
      return reply(id, { isError: true, content: [{ type: 'text', text: String(err.message ?? err) }] });
    }
  }
  return replyError(id, -32601, `Method not found: ${method}`);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      replyError(null, -32700, 'Parse error');
      continue;
    }
    handle(msg).catch((err) => replyError(msg.id ?? null, -32603, String(err.message ?? err)));
  }
});
