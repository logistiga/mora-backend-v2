-- Fixes a naming-convention inconsistency: every other column on llm_calls
-- is snake_case (user_id, provider_id, error_code, cost_estimate, ...) via
-- an explicit @map in schema.prisma, but latencyMs was missed. A plain
-- RENAME COLUMN (rather than DROP+ADD) preserves existing data.
ALTER TABLE "llm_calls" RENAME COLUMN "latencyMs" TO "latency_ms";
