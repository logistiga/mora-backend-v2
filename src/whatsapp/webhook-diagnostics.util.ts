/** Masks a JID to its last four digits for logs; never logs the full number. */
export function maskJid(jid: unknown): string | null {
  if (typeof jid !== 'string' || jid.length === 0) return null;
  const at = jid.indexOf('@');
  const user = at >= 0 ? jid.slice(0, at) : jid;
  const domain = at >= 0 ? jid.slice(at) : '';
  const masked = user.length > 4 ? `${'*'.repeat(user.length - 4)}${user.slice(-4)}` : user;
  return `${masked}${domain}`;
}
