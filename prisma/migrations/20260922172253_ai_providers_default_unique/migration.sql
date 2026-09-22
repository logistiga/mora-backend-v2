-- Enforces "at most one default AiProvider per (user, kind, scope, space)" at
-- the database level, in addition to the transactional unset-then-set logic
-- in AiProviderService.setDefault(). A plain @@unique in schema.prisma can't
-- express this (it would forbid multiple non-default rows too), so this is a
-- partial unique index, applied only WHERE is_default = true.
-- scope/space are nullable (a global provider), so COALESCE them to a
-- constant sentinel — two NULLs are never considered equal by a plain unique
-- index, which would defeat the purpose here.
CREATE UNIQUE INDEX "ai_providers_one_default_per_kind_scope_space"
  ON "ai_providers" ("user_id", "kind", COALESCE("scope", '__global__'), COALESCE("space", '__global__'))
  WHERE "is_default" = true;
