-- CreateEnum
CREATE TYPE "agent_card_grant_period" AS ENUM ('day', 'month');

-- CreateEnum
CREATE TYPE "agent_card_grant_request_status" AS ENUM ('pending', 'approved', 'declined');

-- AlterTable
ALTER TABLE "secrets" ADD COLUMN     "agent_origins" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "agent_card_grants" (
    "id" UUID NOT NULL,
    "secret_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "merchant_origin" TEXT NOT NULL,
    "merchant_site" TEXT NOT NULL,
    "frame_origins" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "max_amount_minor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "period" "agent_card_grant_period",
    "period_max_releases" INTEGER,
    "period_max_amount_minor" INTEGER,
    "include_security_code" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "agent_card_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_card_grant_requests" (
    "id" UUID NOT NULL,
    "secret_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "origin" TEXT NOT NULL,
    "merchant_site" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "agent_card_grant_request_status" NOT NULL DEFAULT 'pending',
    "client_id" TEXT,
    "client_label" TEXT,
    "grant_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ,

    CONSTRAINT "agent_card_grant_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_card_releases" (
    "id" UUID NOT NULL,
    "grant_id" UUID NOT NULL,
    "secret_id" UUID NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_card_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_card_grants_secret_id_merchant_site_idx" ON "agent_card_grants"("secret_id", "merchant_site");

-- CreateIndex
CREATE INDEX "agent_card_grants_user_id_idx" ON "agent_card_grants"("user_id");

-- CreateIndex
CREATE INDEX "agent_card_grant_requests_secret_id_status_idx" ON "agent_card_grant_requests"("secret_id", "status");

-- CreateIndex
CREATE INDEX "agent_card_grant_requests_user_id_status_idx" ON "agent_card_grant_requests"("user_id", "status");

-- CreateIndex
CREATE INDEX "agent_card_releases_grant_id_created_at_idx" ON "agent_card_releases"("grant_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_card_releases_secret_id_created_at_idx" ON "agent_card_releases"("secret_id", "created_at");

-- AddForeignKey
ALTER TABLE "agent_card_grants" ADD CONSTRAINT "agent_card_grants_secret_id_fkey" FOREIGN KEY ("secret_id") REFERENCES "secrets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_card_grants" ADD CONSTRAINT "agent_card_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_card_grant_requests" ADD CONSTRAINT "agent_card_grant_requests_secret_id_fkey" FOREIGN KEY ("secret_id") REFERENCES "secrets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_card_grant_requests" ADD CONSTRAINT "agent_card_grant_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_card_grant_requests" ADD CONSTRAINT "agent_card_grant_requests_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "agent_card_grants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_card_releases" ADD CONSTRAINT "agent_card_releases_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "agent_card_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_card_releases" ADD CONSTRAINT "agent_card_releases_secret_id_fkey" FOREIGN KEY ("secret_id") REFERENCES "secrets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
