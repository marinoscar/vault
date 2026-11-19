-- Host Beta: its own table, after the platform and the Vault domain histories.
CREATE TABLE "beta_notes" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "beta_notes_pkey" PRIMARY KEY ("id")
);
