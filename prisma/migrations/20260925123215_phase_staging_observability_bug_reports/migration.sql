-- AlterTable
ALTER TABLE "llm_calls" ADD COLUMN     "request_id" TEXT;

-- CreateTable
CREATE TABLE "bug_reports" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "request_id" TEXT,
    "conversation_id" UUID,
    "voice_session_id" UUID,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "frontend_route" TEXT,
    "api_route" TEXT,
    "browser_info" TEXT,
    "app_version" TEXT,
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bug_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bug_reports_user_id_status_idx" ON "bug_reports"("user_id", "status");

-- CreateIndex
CREATE INDEX "bug_reports_request_id_idx" ON "bug_reports"("request_id");

-- CreateIndex
CREATE INDEX "bug_reports_conversation_id_idx" ON "bug_reports"("conversation_id");

-- CreateIndex
CREATE INDEX "bug_reports_voice_session_id_idx" ON "bug_reports"("voice_session_id");

-- CreateIndex
CREATE INDEX "llm_calls_request_id_idx" ON "llm_calls"("request_id");

-- AddForeignKey
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
