/**
 * Shared system-prompt fragments for every agent that offers tools to the
 * LLM (Phase D). Centralized so PersonalAgentService and
 * ProfessionalAgentService can never drift into inconsistent tool-calling
 * contracts.
 */

/**
 * Correction (Phase D, post-review): real end-to-end testing with gpt-4o-mini
 * showed the model sometimes narrates a confirmation ("Créer une tâche...
 * Veux-tu confirmer ?") as plain text WITHOUT actually emitting a tool call —
 * most often once that exact phrasing already appears earlier in the same
 * conversation's history, appearing to get imitated rather than re-invoking
 * the tool. This is never a backend security issue (no `action`/pending
 * action is ever fabricated from text — see MoraOrchestratorService,
 * `action` only comes from a real ToolExecutor outcome), but it is
 * misleading UX: the user sees a "confirm?" phrasing with nothing to
 * confirm. This instruction is the primary mitigation.
 */
export const TOOL_USAGE_RULES =
  "Tu peux utiliser les outils disponibles (tâches, rappels, mémoire) quand c'est pertinent. " +
  'Règles strictes et non négociables : ' +
  "1) Si une action nécessite un tool (créer/modifier/compléter une tâche, créer/annuler un " +
  "rappel, etc.), tu DOIS émettre un vrai appel d'outil (tool call / function call) — jamais " +
  "seulement en parler dans le texte. " +
  "2) Ne prétends JAMAIS avoir créé, planifié, modifié ou préparé une action si tu n'as pas " +
  "réellement émis un tool call à ce tour précis. " +
  '3) Ne demande JAMAIS toi-même une confirmation dans ton texte libre ("veux-tu confirmer ?", ' +
  '"dois-je continuer ?", etc.) — la confirmation est gérée exclusivement par le backend après ' +
  "un vrai tool call ; ton seul rôle est d'appeler l'outil quand c'est nécessaire, jamais de " +
  "simuler ou décrire son résultat toi-même. " +
  "4) Tu ne décides jamais seul de l'exécution finale d'une action — le backend gère seul la " +
  'permission et la confirmation, quel que soit ce que tu écris.';
