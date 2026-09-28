const FORBIDDEN_KEY = /(authorization|cookie|token|jwt|password|secret|api[_-]?key|refresh[_-]?token)/i;
// Global (`g`): every occurrence in a string is masked, not just the first.
// Credential-looking values are masked together with their label
// (`password=hunter2` → `[REDACTED]`), so the value never survives next to a
// masked label. Plain prose mentioning these words is left untouched.
const FORBIDDEN_VALUE = new RegExp(
  [
    String.raw`\bbearer\s+[a-z0-9._~+/=-]{8,}`,
    String.raw`\bsk-[a-z0-9_-]{8,}`,
    String.raw`["']?\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)`,
  ].join('|'),
  'gi',
);

const MAX_DEPTH = 4;
const MAX_ARRAY = 20;
const MAX_OBJECT_KEYS = 40;
const MAX_STRING_LENGTH = 1000;

export function sanitizeBugReportMetadata(input: unknown, depth = 0): Record<string, unknown> | null {
  if (!isRecord(input) || depth > MAX_DEPTH) return null;

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input).slice(0, MAX_OBJECT_KEYS)) {
    if (FORBIDDEN_KEY.test(key)) continue;
    const clean = sanitizeValue(value, depth + 1);
    if (clean !== undefined) sanitized[key] = clean;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

export function sanitizeBugReportText(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const compact = value.trim().slice(0, MAX_STRING_LENGTH);
  return compact.replace(FORBIDDEN_VALUE, '[REDACTED]');
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value == null) return undefined;
  if (typeof value === 'string') {
    const sanitized = sanitizeBugReportText(value);
    return sanitized && sanitized !== '[REDACTED]' ? sanitized : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item) => item !== undefined);
    return items.length > 0 ? items : undefined;
  }
  if (isRecord(value)) {
    return sanitizeBugReportMetadata(value, depth + 1) ?? undefined;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
