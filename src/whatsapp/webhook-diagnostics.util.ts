/**
 * Safe, structural summary of an Evolution webhook payload for logs. It keeps
 * field names, types and JID shapes, and never the message text, media, tokens
 * or API keys. Phone-like parts of JIDs are masked to their last 4 digits.
 */
export function maskJid(jid: unknown): string | null {
  if (typeof jid !== 'string' || jid.length === 0) return null;
  const at = jid.indexOf('@');
  const user = at >= 0 ? jid.slice(0, at) : jid;
  const domain = at >= 0 ? jid.slice(at) : '';
  const masked = user.length > 4 ? `${'*'.repeat(user.length - 4)}${user.slice(-4)}` : user;
  return `${masked}${domain}`;
}

const KEY_FIELDS = ['remoteJid', 'remoteJidAlt', 'participant', 'participantAlt', 'senderPn', 'senderLid', 'addressingMode'] as const;

function summarizeKey(key: unknown): Record<string, unknown> {
  if (!key || typeof key !== 'object') return { present: false };
  const k = key as Record<string, unknown>;
  const summary: Record<string, unknown> = {
    present: true,
    hasId: typeof k.id === 'string',
    fromMe: typeof k.fromMe === 'boolean' ? k.fromMe : null,
  };
  for (const field of KEY_FIELDS) {
    if (field in k) summary[field] = maskJid(k[field]);
  }
  return summary;
}

export function summarizeEvolutionPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return { type: typeof payload };
  const p = payload as Record<string, unknown>;
  const data = p.data;
  const dataShape = Array.isArray(data) ? 'array' : data === null ? 'null' : typeof data;
  const dataObj = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  const message = dataObj?.message && typeof dataObj.message === 'object' ? (dataObj.message as Record<string, unknown>) : null;

  return {
    event: typeof p.event === 'string' ? p.event : null,
    topLevelKeys: Object.keys(p).sort(),
    dataShape,
    dataCount: Array.isArray(data) ? data.length : undefined,
    dataKeys: dataObj ? Object.keys(dataObj).sort() : undefined,
    key: summarizeKey(dataObj?.key),
    messageTypes: message ? Object.keys(message).filter((k) => k !== 'messageContextInfo').sort() : undefined,
  };
}
