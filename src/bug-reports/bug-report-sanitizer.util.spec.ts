import { describe, expect, it } from 'vitest';
import {
  sanitizeBugReportMetadata,
  sanitizeBugReportText,
} from './bug-report-sanitizer.util.js';

describe('bug-report sanitizer', () => {
  it('drops forbidden keys and redacts suspicious strings', () => {
    const metadata = sanitizeBugReportMetadata({
      route: '/chat',
      token: 'secret-token',
      nested: {
        password: '123',
        note: 'Authorization: Bearer abc.def.ghi',
      },
    });

    expect(metadata).toEqual({
      nested: {
        note: 'Authorization: [REDACTED]',
      },
      route: '/chat',
    });
  });

  it('redacts dangerous free text patterns', () => {
    expect(sanitizeBugReportText('Bearer abc.def.ghi')).toBe('[REDACTED]');
    expect(sanitizeBugReportText('sk-secret-value-12345678')).toBe('[REDACTED]');
    expect(sanitizeBugReportText('UI freeze on avatar screen')).toBe('UI freeze on avatar screen');
  });

  it('redacts EVERY secret in a single string, not only the first (regression)', () => {
    const text =
      'Header Bearer abc.def.ghi then key sk-live-12345678abcd, retry with Bearer zzz.yyy.xxx ' +
      'and sk-other-87654321zz';
    const out = sanitizeBugReportText(text)!;
    expect(out).toBe(
      'Header [REDACTED] then key [REDACTED], retry with [REDACTED] and [REDACTED]',
    );
    for (const secret of ['abc.def.ghi', 'sk-live-12345678abcd', 'zzz.yyy.xxx', 'sk-other-87654321zz']) {
      expect(out).not.toContain(secret);
    }
  });

  it('masks labelled credentials together with their value, every time', () => {
    const out = sanitizeBugReportText(
      'login password=hunter2 failed; api_key: AKIA123 and secret="s3cr3t value" then password: again42',
    )!;
    expect(out).toBe('login [REDACTED] failed; [REDACTED] and [REDACTED] then [REDACTED]');
    for (const secret of ['hunter2', 'AKIA123', 's3cr3t', 'again42']) expect(out).not.toContain(secret);
  });

  it('masks every credential inside a JSON-looking string', () => {
    const out = sanitizeBugReportText('{"password":"p1","refresh_token":"r2","user":"omar"}')!;
    expect(out).not.toContain('p1');
    expect(out).not.toContain('r2');
    expect(out).toContain('"user":"omar"');
  });

  it('behaves identically on repeated calls (no stateful global regex)', () => {
    const text = 'a Bearer abc.def.ghi b Bearer abc.def.ghi';
    expect(sanitizeBugReportText(text)).toBe('a [REDACTED] b [REDACTED]');
    expect(sanitizeBugReportText(text)).toBe('a [REDACTED] b [REDACTED]');
  });

  it('leaves normal prose untouched, even when it mentions these words', () => {
    for (const text of [
      "Le mot de passe oublié ne s'affiche pas",
      'The password reset screen freezes after the api key step',
      'He was the bearer of bad news about the secret menu',
      'Clé API invalide affichée alors que tout marche',
    ]) {
      expect(sanitizeBugReportText(text)).toBe(text);
    }
  });

  it('redacts every secret in nested metadata strings', () => {
    expect(
      sanitizeBugReportMetadata({ log: 'Bearer abc.def.ghi, Bearer jkl.mno.pqr' }),
    ).toEqual({ log: '[REDACTED], [REDACTED]' });
  });
});
