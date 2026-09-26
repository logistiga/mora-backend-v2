-- CreateTable
CREATE TABLE "vision_assets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "message_id" UUID,
    "scope" TEXT NOT NULL,
    "space" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "storage_provider" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "summary" TEXT,
    "extracted_text" TEXT,
    "analysis" JSONB,
    "metadata" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "analyzed_at" TIMESTAMP(3),

    CONSTRAINT "vision_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vision_assets_user_id_conversation_id_scope_space_created_a_idx" ON "vision_assets"("user_id", "conversation_id", "scope", "space", "created_at");

-- CreateIndex
CREATE INDEX "vision_assets_message_id_idx" ON "vision_assets"("message_id");

-- CreateIndex
CREATE INDEX "vision_assets_checksum_idx" ON "vision_assets"("checksum");

-- AddForeignKey
ALTER TABLE "vision_assets" ADD CONSTRAINT "vision_assets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_assets" ADD CONSTRAINT "vision_assets_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_assets" ADD CONSTRAINT "vision_assets_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
