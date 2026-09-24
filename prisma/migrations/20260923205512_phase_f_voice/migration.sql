-- DropIndex
DROP INDEX "document_chunks_embedding_vector_1536_hnsw_idx";

-- CreateTable
CREATE TABLE "voice_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "space" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "stt_provider" TEXT,
    "tts_provider" TEXT,
    "language" TEXT NOT NULL DEFAULT 'auto',
    "timezone" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'push_to_talk',
    "metadata" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_turns" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "transcript" TEXT,
    "response_text" TEXT,
    "interrupted" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "stt_latency_ms" INTEGER,
    "llm_latency_ms" INTEGER,
    "tts_first_byte_ms" INTEGER,
    "total_latency_ms" INTEGER,
    "pending_action_id" UUID,
    "error_code" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "voice_turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "voice_id" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'auto',
    "speed" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "settings" JSONB,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "voice_sessions_user_id_status_idx" ON "voice_sessions"("user_id", "status");

-- CreateIndex
CREATE INDEX "voice_sessions_conversation_id_idx" ON "voice_sessions"("conversation_id");

-- CreateIndex
CREATE INDEX "voice_turns_session_id_idx" ON "voice_turns"("session_id");

-- CreateIndex
CREATE INDEX "voice_profiles_user_id_idx" ON "voice_profiles"("user_id");

-- AddForeignKey
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_turns" ADD CONSTRAINT "voice_turns_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "voice_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
