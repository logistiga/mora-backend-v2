-- CreateTable
CREATE TABLE "whatsapp_missions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "objective" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "opening_message" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "messages_sent" INTEGER NOT NULL DEFAULT 0,
    "max_messages" INTEGER NOT NULL DEFAULT 10,
    "deadline_at" TIMESTAMP(3) NOT NULL,
    "findings" JSONB NOT NULL DEFAULT '{}',
    "report" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_missions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_missions_conversation_id_status_idx" ON "whatsapp_missions"("conversation_id", "status");

-- CreateIndex
CREATE INDEX "whatsapp_missions_status_deadline_at_idx" ON "whatsapp_missions"("status", "deadline_at");

-- AddForeignKey
ALTER TABLE "whatsapp_missions" ADD CONSTRAINT "whatsapp_missions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_missions" ADD CONSTRAINT "whatsapp_missions_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_missions" ADD CONSTRAINT "whatsapp_missions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
