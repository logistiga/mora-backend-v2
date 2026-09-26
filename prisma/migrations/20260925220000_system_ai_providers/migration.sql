-- SYSTEM AI providers: a row with user_id IS NULL belongs to no user and is
-- shared by everyone (managed by ADMINs only). Non-destructive: existing rows
-- keep their owner and their meaning (personal / BYOK providers).

ALTER TABLE "ai_providers" ALTER COLUMN "user_id" DROP NOT NULL;

-- The partial unique index below guarantees "at most one default per
-- (owner, kind, scope, space)". Two NULLs are never equal for a plain unique
-- index, so the SYSTEM owner (user_id IS NULL) has to be coalesced to a
-- sentinel UUID exactly like scope/space already are.
DROP INDEX IF EXISTS "ai_providers_one_default_per_kind_scope_space";

CREATE UNIQUE INDEX "ai_providers_one_default_per_kind_scope_space"
  ON "ai_providers" (
    COALESCE("user_id", '00000000-0000-0000-0000-000000000000'::uuid),
    "kind",
    COALESCE("scope", '__global__'),
    COALESCE("space", '__global__')
  )
  WHERE "is_default" = true;

-- Read path for the SYSTEM fallback: resolution loads the user's rows and the
-- system rows for one kind in a single query.
CREATE INDEX IF NOT EXISTS "ai_providers_kind_is_active_idx"
  ON "ai_providers" ("kind", "is_active");
