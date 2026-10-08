-- AlterTable
ALTER TABLE "whatsapp_missions"
  ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'personal',
  ADD COLUMN "space" TEXT NOT NULL DEFAULT 'personal',
  ADD COLUMN "confirmed_at" TIMESTAMP(3),
  ADD COLUMN "reminder_id" UUID;
