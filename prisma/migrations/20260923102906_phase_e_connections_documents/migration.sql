-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "space" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "document_type" TEXT,
    "title" TEXT,
    "language" TEXT,
    "source" TEXT NOT NULL DEFAULT 'upload',
    "source_id" TEXT,
    "storage_provider" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "classification_confidence" DOUBLE PRECISION,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT,
    "key_points" JSONB,
    "checksum" TEXT NOT NULL,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "page" INTEGER,
    "section" TEXT,
    "content" TEXT NOT NULL,
    "token_count" INTEGER,
    "embedding" vector,
    "embedding_vector_1536" vector(1536),
    "embedding_model" TEXT,
    "embedding_dimensions" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_tags" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_entities" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "role" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_tables" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "sheet_name" TEXT,
    "table_index" INTEGER NOT NULL,
    "title" TEXT,
    "columns" JSONB NOT NULL,
    "row_count" INTEGER NOT NULL,
    "column_count" INTEGER NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_table_rows" (
    "id" UUID NOT NULL,
    "table_id" UUID NOT NULL,
    "row_index" INTEGER NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "document_table_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "company" TEXT,
    "job_title" TEXT,
    "scope" TEXT NOT NULL,
    "space" TEXT NOT NULL,
    "relationship" TEXT,
    "trust_level" TEXT NOT NULL DEFAULT 'unknown',
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_interaction_at" TIMESTAMP(3),

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "value_normalized" TEXT NOT NULL,
    "display_value" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "credentials_encrypted" TEXT,
    "credentials_iv" TEXT,
    "credentials_auth_tag" TEXT,
    "status" TEXT NOT NULL DEFAULT 'configured',
    "last_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "auto_reply_policy" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_conversations" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "contact_id" UUID,
    "scope" TEXT NOT NULL,
    "space" TEXT NOT NULL,
    "last_message_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "contact_id" UUID,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "status" TEXT,
    "text" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_attachments" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "document_id" UUID,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER,
    "storage_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "imap_host" TEXT,
    "imap_port" INTEGER,
    "smtp_host" TEXT,
    "smtp_port" INTEGER,
    "credentials_encrypted" TEXT,
    "credentials_iv" TEXT,
    "credentials_auth_tag" TEXT,
    "status" TEXT NOT NULL DEFAULT 'configured',
    "last_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_threads" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "subject" TEXT,
    "scope" TEXT NOT NULL,
    "space" TEXT NOT NULL,
    "contact_id" UUID,
    "last_message_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT[],
    "cc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT,
    "text_body" TEXT,
    "html_body_sanitized" TEXT,
    "direction" TEXT NOT NULL,
    "received_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "contact_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_attachments" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "document_id" UUID,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER,
    "storage_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "space" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "recurrence_rule" TEXT,
    "source" TEXT NOT NULL DEFAULT 'mora',
    "source_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_event_participants" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "contact_id" UUID,
    "name" TEXT,
    "email" TEXT,
    "status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_event_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_user_id_scope_space_status_idx" ON "documents"("user_id", "scope", "space", "status");

-- CreateIndex
CREATE INDEX "documents_checksum_idx" ON "documents"("checksum");

-- CreateIndex
CREATE INDEX "documents_source_source_id_idx" ON "documents"("source", "source_id");

-- CreateIndex
CREATE INDEX "document_chunks_document_id_chunk_index_idx" ON "document_chunks"("document_id", "chunk_index");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

-- CreateIndex
CREATE INDEX "document_tags_tag_id_idx" ON "document_tags"("tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_tags_document_id_tag_id_key" ON "document_tags"("document_id", "tag_id");

-- CreateIndex
CREATE INDEX "document_entities_entity_id_idx" ON "document_entities"("entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_entities_document_id_entity_id_key" ON "document_entities"("document_id", "entity_id");

-- CreateIndex
CREATE INDEX "document_tables_document_id_idx" ON "document_tables"("document_id");

-- CreateIndex
CREATE INDEX "document_table_rows_table_id_row_index_idx" ON "document_table_rows"("table_id", "row_index");

-- CreateIndex
CREATE INDEX "contacts_user_id_scope_space_idx" ON "contacts"("user_id", "scope", "space");

-- CreateIndex
CREATE INDEX "contact_identities_contact_id_idx" ON "contact_identities"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_identities_user_id_type_value_normalized_key" ON "contact_identities"("user_id", "type", "value_normalized");

-- CreateIndex
CREATE INDEX "whatsapp_accounts_user_id_idx" ON "whatsapp_accounts"("user_id");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_account_id_idx" ON "whatsapp_conversations"("account_id");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_contact_id_idx" ON "whatsapp_conversations"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_provider_message_id_key" ON "whatsapp_messages"("provider_message_id");

-- CreateIndex
CREATE INDEX "whatsapp_messages_conversation_id_idx" ON "whatsapp_messages"("conversation_id");

-- CreateIndex
CREATE INDEX "whatsapp_attachments_message_id_idx" ON "whatsapp_attachments"("message_id");

-- CreateIndex
CREATE INDEX "email_accounts_user_id_idx" ON "email_accounts"("user_id");

-- CreateIndex
CREATE INDEX "email_threads_account_id_idx" ON "email_threads"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_provider_message_id_key" ON "email_messages"("provider_message_id");

-- CreateIndex
CREATE INDEX "email_messages_thread_id_idx" ON "email_messages"("thread_id");

-- CreateIndex
CREATE INDEX "email_attachments_message_id_idx" ON "email_attachments"("message_id");

-- CreateIndex
CREATE INDEX "calendar_events_user_id_scope_space_starts_at_idx" ON "calendar_events"("user_id", "scope", "space", "starts_at");

-- CreateIndex
CREATE INDEX "calendar_event_participants_event_id_idx" ON "calendar_event_participants"("event_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_tags" ADD CONSTRAINT "document_tags_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_tags" ADD CONSTRAINT "document_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_entities" ADD CONSTRAINT "document_entities_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_entities" ADD CONSTRAINT "document_entities_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_tables" ADD CONSTRAINT "document_tables_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_table_rows" ADD CONSTRAINT "document_table_rows_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "document_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_identities" ADD CONSTRAINT "contact_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_identities" ADD CONSTRAINT "contact_identities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_accounts" ADD CONSTRAINT "whatsapp_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "whatsapp_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_attachments" ADD CONSTRAINT "whatsapp_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "whatsapp_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "email_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "email_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_attachments" ADD CONSTRAINT "email_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "email_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "calendar_event_participants_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Real ANN index (Phase E §13 analysis): pgvector's HNSW/IVFFlat both
-- require a FIXED-dimension vector column (`CREATE INDEX ... USING hnsw`
-- rejects a dimensionless `vector` column with "column does not have
-- dimensions", confirmed against a real Postgres+pgvector instance in
-- Phase C). `document_chunks.embedding` stays the flexible, dimensionless,
-- brute-force-scanned column (any provider/dimension — Memory's existing
-- pattern, never broken). `embedding_vector_1536` is a genuine `vector(1536)`
-- column, written ONLY when an embedding actually has 1536 dimensions
-- (today's real provider, text-embedding-3-small) — this index makes THAT
-- real, common case a true approximate-nearest-neighbor search instead of a
-- sequential scan, without hardcoding 1536 as the only dimension the
-- application code understands (DocumentRetrievalService still falls back
-- to the brute-force `embedding` column for any other dimension).
CREATE INDEX "document_chunks_embedding_vector_1536_hnsw_idx"
  ON "document_chunks"
  USING hnsw ("embedding_vector_1536" vector_cosine_ops);
