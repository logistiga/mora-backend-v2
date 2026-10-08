# Roadmap

État réel du backend. Les phases ci-dessous sont implémentées dans le dépôt (modules, services,
endpoints et tests unitaires). Ce document liste aussi ce qui reste à faire.

## Implémenté

- **Fondations (Phase A)** — NestJS + TypeScript strict, PostgreSQL + pgvector, Prisma (driver
  adapter), Redis, BullMQ, auth JWT access/refresh, `/health`, validation globale, rate limiting,
  redaction des bug reports, Swagger (hors production), Docker Compose.
- **Routeur et agents (Phase B)** — `MoraRouter` classe chaque requête (`personal`,
  `professional`, `hybrid`, `direct`) ; `PersonalAgent` et `ProfessionalAgent` ; `ContextModule`
  reconstruit le contexte ; `OrchestratorModule` orchestre les tours.
- **LLM et fournisseurs** — `LlmModule`, `AiProvidersModule` (sélection de fournisseur par scope et
  espace, configuration en base ou par env). Sans fournisseur configuré, le backend démarre et
  répond « non configuré ».
- **Mémoire et embeddings (Phase C)** — `MemoryModule` (mémoire, faits de profil, résumés de
  conversation, entités, extraction en file), `EmbeddingModule` avec pgvector.
- **Outils et permissions (Phase D)** — `ToolsModule` (registre, exécution, validation),
  `PermissionService`, `AuditModule`, `PendingActionsModule`.
- **Documents, tâches, rappels, notifications (Phase E)** — `DocumentsModule`, `TasksModule`,
  `RemindersModule`, `NotificationsModule`.
- **Canaux et connecteurs (Phase F)** — `WhatsAppModule`, `EmailModule`, `CalendarModule`,
  `GoogleModule`, `ContactsModule`, `BusinessConnectorsModule`, `McpModule`.
- **Voix (Phase G)** — `VoiceModule` : STT, TTS, streaming, barge-in et annulation des tours
  obsolètes.
- **Vision et avatar (Phase H)** — `VisionModule` (dont `voice_snapshot`), `AvatarModule`
  (`/avatar/profile`, `/avatar/status`, événements temps réel).
- **Intégrations ChatGPT** — spec OpenAPI curée pour un GPT personnalisé.

Le suite de tests unitaires (Vitest) passe : 82 fichiers, 620 tests. Le typecheck est propre.

## Reste à faire

1. **Requêtes mixtes (personnel + professionnel).** Une requête `hybrid` n'est jamais fusionnée :
   le routeur la découpe en deux parties (LLM), chaque partie est traitée par son propre agent et
   son propre scope, puis les réponses sont assemblées. Avec `MORA_CROSS_SCOPE_ENABLED=false`
   (défaut), la requête est refusée et l'utilisateur doit reformuler en deux messages. Si le
   découpage échoue (pas de LLM configuré, sortie invalide), même repli. Deux actions outils dans
   le même message sont refusées : elles doivent être envoyées une par une.
2. **Tests e2e.** La suite `npm run test:e2e` exige Postgres et Redis. Elle doit être relancée et
   verte avant une mise en production.
3. **Validation humaine de la voix.** Barge-in, changement de sujet après interruption, STT
   français, reconnexion : voir `docs/OPEN_ISSUES.md`. Ce point ne se valide qu'avec un vrai
   navigateur et un vrai micro.
4. **Validation humaine de l'avatar.** Lisibilité, fluidité et lip-sync heuristique : voir
   `docs/OPEN_ISSUES.md`.
5. **Documentation d'architecture.** `docs/ARCHITECTURE.md` et `docs/LEARNING_CORE.md` décrivent
   encore la Phase A ; à mettre à jour.
