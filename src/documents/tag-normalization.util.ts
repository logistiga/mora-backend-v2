/**
 * Normalizes a raw tag string for the shared `Tag` vocabulary (AGENTS Phase
 * E §7): lowercase, trimmed, accents stripped, spaces/punctuation collapsed
 * to single hyphens. "Client Total", "client  total", "Client-Total" all
 * normalize to "client-total" — this is the actual duplicate-prevention
 * mechanism, not a best-effort suggestion.
 */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}
