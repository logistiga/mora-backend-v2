-- Phase H — Avatar state / preferences

CREATE TABLE "avatar_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Mora Core',
    "avatar_preset" TEXT NOT NULL DEFAULT 'mora_core',
    "render_mode" TEXT NOT NULL DEFAULT 'expressive_orb',
    "base_expression" TEXT NOT NULL DEFAULT 'neutral',
    "expression_intensity" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "lip_sync_mode" TEXT NOT NULL DEFAULT 'viseme_timeline',
    "voice_sync_enabled" BOOLEAN NOT NULL DEFAULT true,
    "idle_enabled" BOOLEAN NOT NULL DEFAULT true,
    "reduced_motion" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "avatar_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "avatar_profiles_user_id_key" ON "avatar_profiles"("user_id");

ALTER TABLE "avatar_profiles"
ADD CONSTRAINT "avatar_profiles_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
