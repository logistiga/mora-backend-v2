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
 * personal/professional scope (e.g. right after the user taught a
 * preference, itself a personal-scoped turn), `applyConversationContinuity`
 * routes every later non-greeting turn to the personal/professional agent,
 * whose system prompt (`PersonalAgentService`/`ProfessionalAgentService`)
 * had no language instruction at all — only `handleDirect` did. Centralizing
 * the instruction here and injecting it at both call sites closes that gap
 * structurally instead of hoping two prompts stay in sync by hand.
 *
 * Deliberately contains no specific language, phrase, or user reference —
 * every rule is phrased in terms of "the current message" / "an explicit
 * request" / "a stored preference", never a hardcoded language or example
 * tied to one user's own words.
 */
export const LANGUAGE_POLICY_INSTRUCTION =
  "Politique de langue (obligatoire, générique — ne dépend d'aucun utilisateur, langue ou " +
  'conversation en particulier) : ' +
  "1) Détecte la langue et le registre du MESSAGE ACTUEL de l'utilisateur (ce tour précis, pas un " +
  'tour précédent) et réponds PAR DÉFAUT dans cette même langue — y compris pour une expression ' +
  "courte (salutation, remerciement, accord/désaccord) et y compris pour un texte en alphabet " +
  'arabe, en darija transcrite en lettres latines, en français, en anglais, ou dans toute autre ' +
  'langue reconnaissable. ' +
  '2) La langue du message actuel a priorité sur : la langue des tours précédents de cette ' +
  "conversation, la langue de ta propre réponse précédente, la langue de l'interface, et toute " +
  "langue par défaut du système. Ne te laisse jamais dicter la langue par l'historique si le " +
  'message actuel est clairement dans une langue différente. ' +
  "3) Si l'utilisateur demande EXPLICITEMENT, dans ce même tour, une langue de réponse différente " +
  '(ex : un message dans une langue, suivi d\'une demande explicite "réponds-moi en <autre ' +
  'langue>"), cette demande explicite du tour actuel l\'emporte sur la détection automatique (règle 1). ' +
  "4) Si une préférence durable listée ci-dessous précise comment choisir la langue de réponse " +
  '(par exemple "toujours répondre dans la langue utilisée par l\'utilisateur" ou "toujours ' +
  'répondre en <langue>"), applique-la de façon cohérente à chaque tour — sauf si le tour actuel ' +
  'contient une demande explicite contraire (règle 3, qui reste toujours prioritaire). ' +
  '5) Message mélangeant plusieurs langues : si une langue de réponse est explicitement demandée, ' +
  'utilise-la ; sinon, détermine la langue dominante ou manifestement voulue par l\'utilisateur pour ' +
  'CE message et réponds dans cette langue — ne réponds jamais dans une langue absente à la fois du ' +
  "message et de toute préférence stockée. " +
  '6) Cette politique s\'applique de façon identique que le message provienne du chat écrit ou de la ' +
  "transcription d'un tour vocal.";

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
