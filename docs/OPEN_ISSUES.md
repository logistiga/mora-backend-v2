# Open Issues

Ce document suit les points encore ouverts qui ne bloquent pas l'avancement du backend, mais qui doivent etre revalides pendant la stabilisation finale.

## Phase F — Voice

### 1. Barge-in backend corrige, validation humaine finale encore requise
- Les garde-fous backend contre les generations stale ont ete renforces.
- Les anciens flux STT/LLM/TTS invalides sont rejetes ou interrompus cote backend.
- Les tests automatises voice et e2e passent.
- Un test humain final reste necessaire pour confirmer le comportement reel en navigateur et au microphone.

### 2. Changement rapide de sujet apres interruption — correction backend implemente, validation humaine finale encore requise
- Les tours assistant interrompus ne doivent plus etre reutilises comme reponses finales dans l'historique LLM.
- Les messages assistant interrompus sont marques comme tels et exclus du prochain contexte reconstruit.
- Les pending actions stale d'un tour interrompu sont annulees.
- Une instruction systeme voice specifique a ete ajoutee pour pousser une reponse directe au nouveau sujet apres interruption.
- Un test humain final reste necessaire pour valider la qualite UX reelle du changement de sujet.

### 3. Stabilite STT francais a surveiller pendant les tests reels
- La propagation de `language=fr` et l'isolation des buffers STT sont couvertes par les tests backend.
- Le gating silence/parole a ete durci cote backend.
- La stabilite micro + navigateur + acoustique reelle doit encore etre observee en environnement humain.

### 4. Frontend / navigateur voice a revalider separement du backend
- Le depot actuel contient le backend voice et ses contrats frontend, mais pas un harness navigateur complet versionne ici.
- Les aspects suivants doivent etre verifies pendant la stabilisation finale sur le frontend reel :
  - listeners WebSocket uniques
  - cycle de vie AudioContext / player
  - cycle de vie MediaRecorder
  - cleanup reconnect / remount / StrictMode
  - purge de queue audio a l'interruption

## Phase H — Avatar / Voice-Vision presentation

### 5. Rendu avatar frontend reel encore a valider humainement
- Le backend expose maintenant les endpoints `/avatar/profile`, `/avatar/status` et les evenements realtime
  `avatar.state`, `assistant.expression`, `avatar.lipsync`.
- Le depot courant ne contient pas encore un renderer frontend final versionne ici.
- Un test humain final reste necessaire pour valider la lisibilite, la fluidite et la coherence visuelle
  du presenter avatar cote navigateur.

### 6. Lip-sync estime a valider en perception reelle
- Le contrat actuel est volontairement heuristique (`viseme_timeline` estime depuis le texte),
  pas un alignement phonemique provider.
- Les tests automatises couvrent la structure, les bornes et la stabilite du payload.
- Un test humain final reste necessaire pour juger si le rendu visuel est suffisamment naturel
  ou s'il faut reduire l'intensite / lisser le rythme cote frontend.

### 7. Reconnexion realtime avatar a revalider sur frontend reel
- Le backend emet maintenant un etat `connection: reconnecting` lors du rattachement a une session voice
  deja active.
- La partie navigateur doit encore etre testee humainement pour verifier :
  - reprise propre de l'UI sans duplication d'evenements
  - gel/reprise correcte des animations
  - absence de desynchronisation audio/avatar apres reconnexion

### 8. Voice + Vision + Avatar UX finale a valider humainement
- Le backend supporte `sourceType = voice_snapshot` avec canal `voice_vision`.
- Les tests backend couvrent la structure contractuelle et l'isolation de contexte.
- Un test humain final reste necessaire pour juger la qualite UX d'un enchainement :
  question vocale -> snapshot explicite -> reponse multimodale -> animation avatar.

## Rappel de stabilisation finale

Les points ci-dessus ne doivent pas etre oublies pendant la stabilisation finale de Mora v2 :
- barge-in humain final
- changement de sujet apres interruption
- stabilite STT francais
- validation frontend/browser du canal voice
- rendu avatar frontend reel
- perception lip-sync reelle
- reconnexion realtime avatar
- UX voice + vision + avatar
