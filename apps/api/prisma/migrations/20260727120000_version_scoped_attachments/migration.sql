-- AlterTable
ALTER TABLE "secret_attachments" ADD COLUMN "secret_version_id" UUID;
ALTER TABLE "secret_attachments" ADD COLUMN "role" TEXT;

-- Backfill: scope every existing attachment to its secret's current version,
-- falling back to the highest version number if no row is flagged current.
UPDATE "secret_attachments" sa
SET "secret_version_id" = sub."id"
FROM (
  SELECT DISTINCT ON ("secret_id") "id", "secret_id"
  FROM "secret_versions"
  ORDER BY "secret_id", "is_current" DESC, "version" DESC
) sub
WHERE sub."secret_id" = sa."secret_id";

-- A secret always has >= 1 version (created atomically with the secret), so this
-- is expected to affect 0 rows.
DELETE FROM "secret_attachments" WHERE "secret_version_id" IS NULL;

ALTER TABLE "secret_attachments" ALTER COLUMN "secret_version_id" SET NOT NULL;

-- DropIndex (superseded by version-scoped uniqueness)
DROP INDEX "secret_attachments_secret_id_storage_object_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "secret_attachments_secret_version_id_storage_object_id_key" ON "secret_attachments"("secret_version_id", "storage_object_id");
CREATE UNIQUE INDEX "secret_attachments_secret_version_id_role_key" ON "secret_attachments"("secret_version_id", "role");
CREATE INDEX "secret_attachments_secret_id_idx" ON "secret_attachments"("secret_id");
CREATE INDEX "secret_attachments_storage_object_id_idx" ON "secret_attachments"("storage_object_id");

-- AddForeignKey
ALTER TABLE "secret_attachments" ADD CONSTRAINT "secret_attachments_secret_version_id_fkey" FOREIGN KEY ("secret_version_id") REFERENCES "secret_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
