/**
 * Shared secret-shaped-value detection, used anywhere untrusted or
 * LLM-produced text is about to be persisted (bug reports today; memory /
 * essential-profile extraction as of the learning-core phase). Centralized
 * so every caller stays in sync instead of maintaining parallel regexes.
 *
 * Global (`g`): every occurrence in a string is masked/detected, not just
 * the first. Credential-looking values are matched together with their
 * label (`password=hunter2`), so the value never survives next to a masked
 * label. Plain prose mentioning these words (e.g. "n'oublie jamais ton mot
 * de passe") is left untouched — only value-shaped matches trigger.
 */
export const SECRET_VALUE_PATTERN = new RegExp(
  [
    String.raw`\bbearer\s+[a-z0-9._~+/=-]{8,}`,
    String.raw`\bsk-[a-z0-9_-]{8,}`,
    String.raw`["']?\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)`,
  ].join('|'),
  'gi',
);

const FORBIDDEN_KEY = /(authorization|cookie|token|jwt|password|secret|api[_-]?key|refresh[_-]?token|encryption[_-]?key)/i;

/** True if the text contains a secret-shaped value (not just the word "password" in prose). */
export function containsSecret(text: string): boolean {
  SECRET_VALUE_PATTERN.lastIndex = 0;
  return SECRET_VALUE_PATTERN.test(text);
}

/** True if a key name itself looks like it names a credential (used to reject a proposed ProfileFact `key`). */
export function isForbiddenKeyName(key: string): boolean {
  return FORBIDDEN_KEY.test(key);
}

export function redactSecrets(text: string): string {
  SECRET_VALUE_PATTERN.lastIndex = 0;
  return text.replace(SECRET_VALUE_PATTERN, '[REDACTED]');
}
