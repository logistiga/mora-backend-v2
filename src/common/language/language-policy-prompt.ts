import { detectScriptLanguage } from './script-language.util.js';

/**
 * Generic, non-user-specific language-selection policy shared by EVERY LLM
 * call that produces a user-facing reply: the tool-less "direct" route
 * (`MoraOrchestratorService.handleDirect`) and the personal/professional
 * agents (`ContextBuilderService.build`) — Chat and Voice alike, since Voice
 * reuses the exact same Orchestrator call (`VoiceTurnRunnerService.run`).
 *
 * Why this exists as its own shared constant rather than being written once
 * per call site: a real-world regression proved call sites drift. The
 * "Salam" bug was fixed for `handleDirect` (learning-core phase), but a
 * later real voice test showed the SAME conversation still answered some
 * Arabic turns in French — because once a conversation has an active
 * personal/professional scope, `applyConversationContinuity` routes every
 * later non-greeting turn to the personal/professional agent, whose system
 * prompt had no language instruction at all. Centralizing the instruction
 * here and injecting it at both call sites closes that gap structurally.
 *
 * v2 (short/ambiguous-turn fix): a further real staging test showed that
 * even with the policy above, a short transliterated greeting like "Salaam"
 * could produce a MIXED-language reply (an Arabic-transliterated greeting
 * followed by a French sentence) — the model treated the greeting word as a
 * weak, isolated signal and defaulted the rest of the reply to French rather
 * than treating a stored "answer in the language I use" preference as
 * decisive for a turn this short/ambiguous. Rewritten with an explicit,
 * numbered, reliability-gated priority order and an explicit prohibition on
 * mixing languages within one reply.
 *
 * Deliberately contains no specific language, phrase, or user reference —
 * every rule is phrased in terms of "the current message" / "an explicit
 * request" / "a stored preference", never a hardcoded language or example
 * tied to one user's own words.
 */
export const LANGUAGE_POLICY_INSTRUCTION =
  "Politique de langue (obligatoire, générique — ne dépend d'aucun utilisateur, langue ou " +
  'conversation en particulier). Ordre de priorité déterministe pour choisir la langue de TA ' +
  'réponse à CE tour : ' +
  '1) Demande explicite de langue de réponse formulée DANS CE TOUR (ex : un message suivi de ' +
  '"réponds-moi en <autre langue>") — priorité absolue, l\'emporte toujours sur tout le reste. ' +
  "2) Détection fiable de la langue du MESSAGE ACTUEL : quand ce message donne un signal clair et " +
  'non ambigu de sa langue (une phrase substantielle, sans ambiguïté d\'écriture ou de ' +
  'translittération), réponds par défaut dans cette langue — qu\'il s\'agisse d\'un texte en ' +
  "alphabet arabe, en français, en anglais, ou dans toute autre langue reconnaissable. La langue du " +
  "message actuel prime alors sur celle des tours précédents, sur ta propre réponse précédente, sur " +
  "la langue de l'interface et sur toute langue par défaut du système. " +
  "3) Préférence de communication durable listée ci-dessous (Profil Essentiel), quand elle précise " +
  'comment choisir la langue de réponse (par exemple "répondre dans la langue utilisée par ' +
  'l\'utilisateur" ou "toujours répondre en <langue>") : ' +
  "a) si CE tour est court, ambigu, ou une expression informelle/translittérée (donc sans détection " +
  "fiable au sens de la règle 2) — y compris quand un signal lexical faible ci-dessous suggère une " +
  "langue — cette préférence devient le critère décisif, plus fort que toute déduction fragile ; " +
  'b) si la préférence décrit elle-même une règle de langue fixe (ex : "toujours répondre en ' +
  '<langue>, quelle que soit la langue utilisée par l\'utilisateur"), applique-la de façon cohérente ' +
  "à CHAQUE tour, y compris quand la règle 2 détecterait normalement une autre langue — seule une " +
  'demande explicite du tour actuel (règle 1) peut la contourner. ' +
  "4) Si aucune des règles 1 à 3 ne donne de résultat : langue des tours précédents de cette " +
  "conversation ou de ta propre réponse précédente. " +
  '5) Langue par défaut générique du système : dernier recours uniquement, seulement si rien ' +
  "ci-dessus ne donne d'indication. " +
  'Règles supplémentaires (non négociables) : ' +
  "— Ta réponse ENTIÈRE doit être dans UNE SEULE langue cohérente, du début à la fin. Ne mélange " +
  "JAMAIS deux langues dans la même réponse (par exemple : ne commence jamais une salutation dans " +
  "une langue pour continuer le reste de la réponse dans une autre). " +
  '— Message de l\'utilisateur mélangeant plusieurs langues : si une langue de réponse est ' +
  "explicitement demandée (règle 1), utilise-la ; sinon, détermine la langue dominante ou " +
  'manifestement voulue par l\'utilisateur pour CE message et réponds ENTIÈREMENT dans cette seule ' +
  "langue — ne réponds jamais dans une langue absente à la fois du message et de toute préférence " +
  "stockée, et ne réponds jamais dans plusieurs langues à la fois même si le message lui-même en " +
  'mélange. ' +
  "— Cette politique s'applique de façon identique que le message provienne du chat écrit ou de la " +
  'transcription d\'un tour vocal.';

/**
 * Builds a small, clearly-labelled "secondary signal" note from a
 * best-effort language hint the Speech-to-Text provider itself returned for
 * this turn (e.g. Whisper's own detected-language field). Never authoritative
 * — the transcript TEXT and the rules above always take precedence — because
 * STT language detection is known to be unreliable on short utterances and
 * is not itself a language model. Returns `null` when there is nothing
 * useful to say (no hint, or the caller didn't capture one), so callers can
 * skip adding an empty/pointless note.
 */
export function buildSttLanguageSignalNote(detectedLanguage: string | undefined | null): string | null {
  if (!detectedLanguage || !detectedLanguage.trim()) return null;
  return (
    'Signal secondaire (reconnaissance vocale, indicatif seulement, potentiellement imprécis) : ' +
    `la transcription de ce tour vocal indique une langue probable = "${detectedLanguage.trim()}". ` +
    'Ceci ne remplace jamais la politique de langue ci-dessus : la langue réelle à utiliser doit ' +
    "toujours être déterminée en priorité à partir du texte du message lui-même et de toute " +
    'préférence explicite ou durable.'
  );
}

/**
 * A message this short (in words) has no reliable current-turn language
 * signal on its own (policy rule 2 above) — this is the generic, word-count
 * based definition of "short/ambiguous turn" the policy's rule 3(a) refers
 * to. Deliberately the same order of magnitude as the router's own
 * GREETING_MAX_WORDS (mora-router.service.ts) without importing it, to avoid
 * a cross-module coupling for what is conceptually a prompt-construction
 * concern, not a routing one.
 */
const SHORT_TURN_MAX_WORDS = 6;

/**
 * Builds a small, clearly-labelled, NON-authoritative lexical signal for a
 * short/ambiguous turn (see `LANGUAGE_POLICY_INSTRUCTION` rule 3(a)) — the
 * generic "small lexical signal layer" fallback/tie-breaker requested
 * alongside the priority-order fix, reusing the existing script/vocabulary
 * heuristic (`detectScriptLanguage`) rather than a new brittle word list.
 * Only fires for short messages: a long message already has a reliable
 * current-turn signal (rule 2) and doesn't need this tie-breaker. Returns
 * `null` when the message is long, empty, or the heuristic found nothing —
 * so a call site can skip adding an empty/pointless note.
 */
export function buildShortTurnLexicalSignalNote(message: string): string | null {
  const wordCount = message.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount === 0 || wordCount > SHORT_TURN_MAX_WORDS) return null;

  const detected = detectScriptLanguage(message);
  if (detected === 'unknown') return null;

  return (
    'Signal lexical faible (indicatif seulement — ce tour est court/ambigu, voir règle 3(a) de la ' +
    `politique de langue ci-dessus) : ce message ressemble à une expression associée à "${detected}". ` +
    "Ce n'est PAS une certitude : pour un tour aussi court, une préférence durable ci-dessus qui " +
    'précise comment choisir la langue de réponse doit primer sur ce simple indice lexical faible.'
  );
}
