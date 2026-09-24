# Debug Session: voice-barge-in
- **Status**: [OPEN]
- **Issue**: Le barge-in Phase F reste défaillant pendant `assistant_speaking`, avec chevauchement audio, tours concurrents et instabilité STT.
- **Debug Server**: Pending
- **Log File**: .dbg/trae-debug-log-voice-barge-in.ndjson

## Reproduction Steps
1. Démarrer le flux voice Phase F.
2. Laisser l'assistant parler.
3. Interrompre pendant `assistant_speaking`.
4. Observer si l'ancien audio continue, si un nouveau tour démarre proprement, et si le STT reste stable en français.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Le frontend garde plusieurs listeners WebSocket / players / recorders actifs. | High | Low | Inconclusive in this repo: aucun source frontend navigateur versionné ici, seulement contrat/API docs. |
| B | Le backend laisse une ancienne génération/TTS émettre après interruption. | High | Medium | Confirmed in part, then fixed: `voice-turn-runner.service.spec.ts` prouve déjà l'abandon des générations stale côté LLM/TTS; un second trou restait au niveau STT `finalize()` tardif (voir C). |
| C | Les buffers STT/audio ne sont pas isolés par turn. | High | Medium | Confirmed: nouveau test `voice-gateway.barge-in.spec.ts` a reproduit qu'un ancien `finalize()` STT pouvait encore lancer `turn-2` après `turn-1` plus récent; corrigé via `sttGenerationId` + rejet `stale_stt_finalize_dropped`. |
| D | `language=fr` ou `auto` ne sont pas propagés jusqu'au provider. | Medium | Low | Rejected as root cause principal, but verified: `openai-stt.provider.spec.ts` prouve `language=fr` envoyé, `auto` omis, `darija -> ar`. |
| E | La queue audio frontend n'est pas purgée complètement lors du barge-in. | High | Low | Backend-side guard confirmed/fixed: `voice-turn-runner.service.spec.ts` prouve qu'un chunk TTS stale est drop après invalidation; la purge d'une queue/player frontend ne peut pas être auditée ici faute de code frontend. |

## Log Evidence
- Reproduction automatisée ajoutée: `src/voice/voice-gateway.barge-in.spec.ts`
- Avant fix: un ancien `finalize()` STT tardif relançait une réponse stale après qu'un tour plus récent avait déjà démarré.
- Après fix: événement debug `stale_stt_finalize_dropped` émis, aucun second `turnRunner.run()`, aucun second `transcript.final` vers le socket.
- STT silence gating conservé: `voice-audio-silence-gating.spec.ts` confirme que seules les frames de parole (+ petit pré-roll) partent au provider.
- Propagation langue confirmée: `openai-stt.provider.spec.ts` valide `language=fr`.

## Verification Conclusion
- Root cause confirmed: la garde de génération existait pour LLM/TTS, mais pas pour le résultat asynchrone d'un `sttSession.finalize()` devenu stale. Ce résultat tardif pouvait encore émettre un transcript et démarrer un nouveau tour assistant, recréant les chevauchements audio/tours observés.
- Fix appliqué: rattacher chaque session STT à `sttGenerationId`, bump de génération au vrai `speech_started`, et drop de tout `finalize()` dont la génération n'est plus courante avant émission côté socket / démarrage du tour.
