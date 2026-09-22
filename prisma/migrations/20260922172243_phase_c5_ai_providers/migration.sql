-- CreateTable
CREATE TABLE "ai_providers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "base_url" TEXT,
    "model" TEXT NOT NULL,
    "api_key_encrypted" TEXT,
    "api_key_iv" TEXT,
    "api_key_auth_tag" TEXT,
    "api_key_hint" TEXT,
    "encryption_version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "space" TEXT,
    "capabilities" JSONB,
    "settings" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "last_tested_at" TIMESTAMP(3),
    "last_test_status" TEXT,
    "last_test_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_calls" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "provider_id" UUID,
    "kind" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "route" TEXT,
    "scope" TEXT,
    "space" TEXT,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "total_tokens" INTEGER,
    "latencyMs" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "cost_estimate" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_providers_user_id_kind_is_active_idx" ON "ai_providers"("user_id", "kind", "is_active");

-- CreateIndex
CREATE INDEX "llm_calls_user_id_idx" ON "llm_calls"("user_id");

-- CreateIndex
CREATE INDEX "llm_calls_provider_id_idx" ON "llm_calls"("provider_id");

-- AddForeignKey
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
