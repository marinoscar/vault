-- AlterTable
ALTER TABLE "secrets" ADD COLUMN     "broker_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "broker_access_changed_at" TIMESTAMPTZ,
ADD COLUMN     "broker_field" TEXT,
ADD COLUMN     "broker_injection" JSONB,
ADD COLUMN     "broker_origins" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "broker_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "secret_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "expires_at" TIMESTAMPTZ,
    "last_used_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broker_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "broker_tokens_token_hash_key" ON "broker_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "broker_tokens_user_id_idx" ON "broker_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "broker_tokens" ADD CONSTRAINT "broker_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
