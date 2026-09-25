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
});
