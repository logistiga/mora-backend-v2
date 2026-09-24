import { Injectable } from '@nestjs/common';

/**
 * Bounded, non-fuzzy affirmative/negative phrase matching for voice
 * confirmations (AGENTS Phase F §23: never treat a bare "oui" as a
 * universal confirmation without binding it to a specific pendingActionId).
 * This is intentionally a small whitelist, NOT free-form NLP intent
 * detection — a transcript that doesn't match either list is treated as a
 * brand new message and goes through the normal Orchestrator path (which
 * itself re-asks for confirmation if it re-proposes the same tool call).
 */
const AFFIRMATIVE_PHRASES = [
  'oui',
  'oui confirme',
  "oui, confirme",
  "oui c'est ça",
  "d'accord",
  'daccord',
  'confirme',
  'confirmé',
  "j'accepte",
  'ok',
  "vas-y",
  'yes',
  'yes confirm',
  'confirm',
  'go ahead',
];

const NEGATIVE_PHRASES = ['non', 'annule', 'annulé', 'stop', "j'annule", 'no', 'cancel', 'never mind'];

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[.,!?]/g, '')
    .trim();
}

export type ConfirmationIntent = 'affirm' | 'deny' | 'none';

@Injectable()
export class VoiceConfirmationService {
  classify(transcript: string): ConfirmationIntent {
    const normalized = normalize(transcript);
    if (AFFIRMATIVE_PHRASES.includes(normalized)) return 'affirm';
    if (NEGATIVE_PHRASES.includes(normalized)) return 'deny';
    return 'none';
  }
}
