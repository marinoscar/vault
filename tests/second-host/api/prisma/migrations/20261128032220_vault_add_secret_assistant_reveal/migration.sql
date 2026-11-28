-- AlterTable
ALTER TABLE "secrets" ADD COLUMN     "assistant_reveal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "assistant_reveal_changed_at" TIMESTAMPTZ;
