import { describe, expect, it } from 'vitest';
import { maskJid, summarizeEvolutionPayload } from './webhook-diagnostics.util.js';

describe('maskJid', () => {
  it('keeps only the last four digits of the user part and the domain', () => {
    expect(maskJid('24162222111@s.whatsapp.net')).toBe('*******2111@s.whatsapp.net');
  });

  it('returns null for missing values and never echoes a non-string', () => {
    expect(maskJid(undefined)).toBeNull();
    expect(maskJid('')).toBeNull();
    expect(maskJid(42)).toBeNull();
  });
});

describe('summarizeEvolutionPayload', () => {
  const payload = {
    event: 'messages.upsert',
    instance: 'Mora',
    apikey: 'SECRET-DO-NOT-LOG',
    sender: '24161004434@s.whatsapp.net',
    data: {
      key: { id: 'ABC', remoteJid: '132276520259667@lid', fromMe: false, senderPn: '24162222111@s.whatsapp.net' },
      pushName: 'Omar',
      message: { conversation: 'texte privé à ne pas journaliser', messageContextInfo: { messageSecret: 'x' } },
      messageTimestamp: 1791147542,
    },
  };

  it('describes the shape without any text, secret or raw identifier', () => {
    const json = JSON.stringify(summarizeEvolutionPayload(payload));
    expect(json).not.toContain('texte privé');
    expect(json).not.toContain('SECRET-DO-NOT-LOG');
    expect(json).not.toContain('132276520259667');
    expect(json).not.toContain('24162222111');
    expect(json).not.toContain('messageSecret');
  });

  it('reports the JID fields that matter for LID resolution, masked', () => {
    const summary = summarizeEvolutionPayload(payload) as { key: Record<string, unknown> };
    expect(summary.key.remoteJid).toBe('***********9667@lid');
    expect(summary.key.senderPn).toBe('*******2111@s.whatsapp.net');
    expect(summary.key.fromMe).toBe(false);
  });

  it('marks array batches explicitly so an array payload is visible in the logs', () => {
    const summary = summarizeEvolutionPayload({ event: 'messages.upsert', data: [payload.data, payload.data] });
    expect(summary).toMatchObject({ dataShape: 'array', dataCount: 2 });
  });

  it('handles a non-object payload safely', () => {
    expect(summarizeEvolutionPayload('oops')).toEqual({ type: 'string' });
  });
});
