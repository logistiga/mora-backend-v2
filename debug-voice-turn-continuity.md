# Debug Session: voice-turn-continuity
- **Status**: [OPEN]
- **Issue**: Après un barge-in, Mora change parfois mal de sujet et semble réutiliser une partie du tour assistant interrompu dans le contexte du tour suivant.
- **Debug Server**: Pending
- **Log File**: .dbg/trae-debug-log-voice-turn-continuity.ndjson

## Reproduction Steps
1. Démarrer une session voice.
2. Demander un sujet A.
3. Interrompre Mora pendant `assistant_speaking`.
4. Demander clairement un sujet B sans rapport.
5. Vérifier si la réponse repart directement sur B ou si elle continue / résume A.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Le tour assistant interrompu est persisté comme une réponse complète dans l'historique conversationnel. | High | Medium | Confirmed. `VoiceTurnRunnerService` pouvait encore appeler `voiceTurnService.complete()` après interruption/staleness, et `MoraOrchestratorService` persistait déjà un `Message` assistant complet. |
| B | Le contexte reconstruit pour le nouveau tour voice inclut du texte assistant partiel ou un artefact stale du tour précédent. | High | Medium | Confirmed. `ConversationsService.getScopedHistory()` ne filtrait pas les messages assistant marqués interrompus, donc le prochain prompt LLM pouvait relire une réponse non terminée comme finale. |
| C | Le nouveau tour après interruption ne recalcule pas complètement route/scope/space/intent. | Medium | Medium | Rejected as root cause. `MoraOrchestratorService` recalcule bien `routerService.classify()` à chaque `handleMessage()`; un test couvre désormais 3 changements successifs de sujet dans la même conversation. |
| D | Un pending action ou tool call incomplet du tour interrompu reste ouvert et pollue la suite. | Medium | Medium | Confirmed. Le chemin stale conservait potentiellement un `pendingActionId` ouvert. Corrigé par annulation backend (`cancel`) et retrait des références stale. |
| E | Le prompt voice manque d'instruction explicite de changement de sujet après interruption, donc le modèle lisse la transition au lieu de repartir net. | Medium | Low | Confirmed as contributing factor, not sole root cause. Une note système voice spécifique est maintenant injectée sur le premier tour suivant une interruption récente. |

## Log Evidence
- `stale_generation_abandoned` sur les runs assistant supersédés
- `stale_stt_finalize_dropped` déjà couvert par le correctif précédent
- nouveaux tests :
  - `src/conversations/conversations.service.spec.ts`
  - `src/orchestrator/mora-orchestrator.service.spec.ts`
  - `src/agents/personal-agent.service.spec.ts`
  - renforts dans `src/voice/voice-turn-runner.service.spec.ts`

## Verification Conclusion
- Cause racine confirmée : un tour voice interrompu pouvait continuer à vivre comme une réponse assistant "complète" à deux niveaux :
  1. le `VoiceTurn` pouvait être recomplété après interruption ;
  2. le `Message` assistant déjà persisté par l'orchestrateur n'était ni marqué ni filtré hors de l'historique LLM.
- Fix appliqué :
  - un `VoiceTurn` interrompu ne repasse plus en `completed`
  - le `Message` assistant stale est marqué `interrupted`
  - `ConversationsService.getScopedHistory()` exclut ces messages
  - les `pending_action` stale sont annulées
  - le premier tour voice après interruption reçoit une consigne système explicite de repartir directement sur le nouveau sujet
