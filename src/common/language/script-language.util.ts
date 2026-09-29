/**
 * A tiny, generic script/vocabulary heuristic — NOT a replacement for real
 * language understanding. It exists solely for the "no LLM configured"
 * degraded path (see MoraOrchestratorService.handleDirect): when there is no
 * model to actually read the message and the learned preference, this is
 * the only way to make even a best-effort attempt at honouring "answer in
 * the language I'm using" instead of always defaulting to French. The
 * primary mechanism is always the real LLM call, which is far more capable
 * and is never bypassed when a provider is configured.
 *
 * Generic on purpose: no user-specific phrases, no hardcoded routing rules —
 * just Unicode script ranges and a handful of extremely common stopwords per
 * language, the same kind of signal any generic langdetect approach starts
 * from.
 */
export type DetectedScriptLanguage = 'ar' | 'fr' | 'en' | 'darija' | 'unknown';

const ARABIC_SCRIPT = /[؀-ۿݐ-ݿ]/;
// Latin-script Darija commonly substitutes Arabic phonemes with digits
// (3=ع, 7=ح, 9=ق/ص, 5=خ) inside otherwise-Latin words — a well-known,
// generic convention, not anything user-specific.
const DARIJA_LATIN_DIGITS = /[a-z](?=[3579])|[3579](?=[a-z])/i;
// A handful of extremely common Latin-transliterated Arabic/Darija greeting
// and courtesy words — the same kind of generic, widely-known vocabulary
// GREETING_PATTERN (mora-router.service.ts) already recognizes across
// several languages (bonjour/hello/salam/...), not anything user-specific.
const ARABIC_LATIN_GREETING_WORDS = /\b(salam|salaam|assalamu|slm|marhaba|marhaban|ahlan|labas|chokran|choukran)\b/i;
const FRENCH_STOPWORDS = /\b(le|la|les|je|tu|nous|vous|bonjour|merci|salut|et|est|pas|avec|pour)\b/i;
const ENGLISH_STOPWORDS = /\b(the|hello|thanks|you|and|is|are|with|for|please)\b/i;

/** Best-effort script/vocabulary detection — see module doc. Never throws, never guesses confidently. */
export function detectScriptLanguage(text: string): DetectedScriptLanguage {
  const trimmed = text.trim();
  if (!trimmed) return 'unknown';

  if (ARABIC_SCRIPT.test(trimmed)) return 'ar';
  if (DARIJA_LATIN_DIGITS.test(trimmed)) return 'darija';
  if (ARABIC_LATIN_GREETING_WORDS.test(trimmed)) return 'ar';
  if (FRENCH_STOPWORDS.test(trimmed)) return 'fr';
  if (ENGLISH_STOPWORDS.test(trimmed)) return 'en';
  return 'unknown';
}
