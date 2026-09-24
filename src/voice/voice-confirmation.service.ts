import { Injectable } from '@nestjs/common';

/**
 * Bounded, non-fuzzy affirmative/negative intent matching for voice
 * confirmations (AGENTS Phase F §23: never treat a bare "oui" as a
 * universal confirmation without binding it to a specific pendingActionId).
 * This is intentionally a small keyword/phrase whitelist, NOT free-form NLP
 * or an LLM call — a transcript that doesn't match either list is treated
 * as a brand new message and goes through the normal Orchestrator path.
 *
 * BUG FIX (Phase G real-microphone regression, found live): the original
 * implementation required the ENTIRE normalized transcript to equal one of
 * a handful of exact phrases. Real spoken confirmations vary — "Oui, je
 * confirme.", "Je voulais bien confirmer." — and none of those match an
 * exact string, so genuine "oui"/"confirme" turns silently fell through to
 * a brand-new Orchestrator call instead of resolving the pending
 * confirmation. Because the LLM still had the pending request in context,
 * it re-proposed the SAME tool call, creating a SECOND pending_action
 * instead of approving the first — reproduced and confirmed via real
 * voice_turns/pending_actions rows during manual testing (see the Phase G
 * bug report for the full trace).
 *
 * Fix: match individual AFFIRMATIVE/NEGATIVE keywords as whole tokens (or
 * short fixed phrases as substrings) within a SHORT utterance only (at most
 * MAX_CONFIRMATION_WORDS words) — short enough that "Oui, je confirme."
 * and "Je voulais bien confirmer." both match, while a long, unrelated
 * sentence that happens to contain "oui" in passing never does. Still
 * entirely deterministic, still no LLM involved in deciding confirmation
 * intent or resolving which pendingActionId it applies to (that binding
 * stays in VoiceTurnRunnerService, scoped to session/user — unchanged).
 */
const MAX_CONFIRMATION_WORDS = 8;

// Single tokens unambiguous enough to check as whole-word matches.
const AFFIRMATIVE_WORDS = [
  'oui',
  'confirme',
  'confirmé',
  'confirmer',
  'accord',
  'daccord',
  'ok',
  'okay',
  'yes',
  'confirm',
  'confirmed',
];
const NEGATIVE_WORDS = ['non', 'annule', 'annulé', 'annuler', 'stop', 'jamais', 'no', 'cancel'];

// Multi-word markers checked as substrings of the normalized transcript —
// deliberately NOT single tokens, since a word like "vas" alone is far too
// generic ("Comment vas-tu ?" must never be read as a confirmation).
const AFFIRMATIVE_PHRASES = ['vas y', 'cest bon', 'go ahead', 'sounds good'];
const NEGATIVE_PHRASES = ["ne fais pas", 'pas question', 'laisse tomber', 'never mind'];

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/['’]/g, '') // elide apostrophes so contractions merge into one token: "c'est" -> "cest", "d'accord" -> "daccord"
    .replace(/[.,!?;:"-]/g, ' ') // hyphen becomes a space, so "vas-y" tokenizes the same as "vas y"
    .replace(/\s+/g, ' ')
    .trim();
}

export type ConfirmationIntent = 'affirm' | 'deny' | 'none';

@Injectable()
export class VoiceConfirmationService {
  classify(transcript: string): ConfirmationIntent {
    const normalized = normalize(transcript);
    if (!normalized) return 'none';

    const words = normalized.split(' ');
    if (words.length > MAX_CONFIRMATION_WORDS) return 'none'; // long utterances are new messages, not confirmations

    const hasAffirmative =
      words.some((w) => AFFIRMATIVE_WORDS.includes(w)) || AFFIRMATIVE_PHRASES.some((p) => normalized.includes(p));
    const hasNegative =
      words.some((w) => NEGATIVE_WORDS.includes(w)) || NEGATIVE_PHRASES.some((p) => normalized.includes(p));

    // A transcript matching both (or neither) is ambiguous — never guess.
    if (hasAffirmative && !hasNegative) return 'affirm';
    if (hasNegative && !hasAffirmative) return 'deny';
    return 'none';
  }
}
