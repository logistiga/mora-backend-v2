-- CreateTable
CREATE TABLE "memories" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "space" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "source" TEXT NOT NULL,
    "source_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'active',
    "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMP(3),
    "last_accessed_at" TIMESTAMP(3),
    "access_count" INTEGER NOT NULL DEFAULT 0,
    "superseded_by_id" UUID,
    "embedding" vector,
    "embedding_model" TEXT,
    "embedding_dimensions" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "space" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_entities" (
    "id" UUID NOT NULL,
    "memory_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "role" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_summaries" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "space" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "from_message_id" UUID,
    "to_message_id" UUID,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "approx_token_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_facts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "space" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMP(3),
    "superseded_by_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profile_facts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "memories_superseded_by_id_key" ON "memories"("superseded_by_id");

-- CreateIndex
CREATE INDEX "memories_user_id_scope_space_status_idx" ON "memories"("user_id", "scope", "space", "status");

-- CreateIndex
CREATE INDEX "memories_user_id_status_kind_idx" ON "memories"("user_id", "status", "kind");

-- CreateIndex
CREATE INDEX "entities_user_id_scope_space_idx" ON "entities"("user_id", "scope", "space");

-- CreateIndex
CREATE UNIQUE INDEX "entities_user_id_scope_space_type_name_key" ON "entities"("user_id", "scope", "space", "type", "name");

-- CreateIndex
CREATE INDEX "memory_entities_entity_id_idx" ON "memory_entities"("entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "memory_entities_memory_id_entity_id_key" ON "memory_entities"("memory_id", "entity_id");

-- CreateIndex
CREATE INDEX "conversation_summaries_user_id_idx" ON "conversation_summaries"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_summaries_conversation_id_scope_space_key" ON "conversation_summaries"("conversation_id", "scope", "space");

-- CreateIndex
CREATE UNIQUE INDEX "profile_facts_superseded_by_id_key" ON "profile_facts"("superseded_by_id");

-- CreateIndex
CREATE INDEX "profile_facts_user_id_scope_space_status_idx" ON "profile_facts"("user_id", "scope", "space", "status");

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "memories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entities" ADD CONSTRAINT "entities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_entities" ADD CONSTRAINT "memory_entities_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_entities" ADD CONSTRAINT "memory_entities_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_facts" ADD CONSTRAINT "profile_facts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_facts" ADD CONSTRAINT "profile_facts_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "profile_facts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
