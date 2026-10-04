-- CreateTable
CREATE TABLE "google_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "google_email" TEXT NOT NULL,
    "scopes" TEXT[],
    "refresh_token_encrypted" TEXT NOT NULL,
    "refresh_token_iv" TEXT NOT NULL,
    "refresh_token_auth_tag" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "google_accounts_user_id_key" ON "google_accounts"("user_id");

-- AddForeignKey
ALTER TABLE "google_accounts" ADD CONSTRAINT "google_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
