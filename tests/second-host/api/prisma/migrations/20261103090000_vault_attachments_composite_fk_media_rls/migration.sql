-- E6.2 (#132): two schema gaps left open by the storage adoption, app tables only.
--
-- 1. secret_attachments gets org_id and a composite foreign key
--    (storage_object_id, org_id) -> storage_objects (id, org_id), the platform
--    convention for a link between org-owned rows. UNIQUE (id, org_id) on
--    storage_objects comes from platform migration 0025_org_scoped_rls.
-- 2. media_folder_files gets row-level security with the standard org_id policy.
--
-- Runs with app.rls_bypass for the transaction: the backfill reads storage_objects,
-- an RLS table (without it a non-superuser role sees zero rows).

BEGIN;
SELECT set_config('app.rls_bypass', 'on', true);

-- AlterTable: expand, backfill, contract
ALTER TABLE "secret_attachments" ADD COLUMN "org_id" UUID;

UPDATE "secret_attachments" sa
SET "org_id" = so."org_id"
FROM "storage_objects" so
WHERE so."id" = sa."storage_object_id";

ALTER TABLE "secret_attachments" ALTER COLUMN "org_id" SET NOT NULL;

-- AddForeignKey: the plain foreign key goes, the composite one replaces it
ALTER TABLE "secret_attachments" DROP CONSTRAINT "secret_attachments_storage_object_id_fkey";

ALTER TABLE "secret_attachments" ADD CONSTRAINT "secret_attachments_storage_object_id_org_id_fkey" FOREIGN KEY ("storage_object_id", "org_id") REFERENCES "storage_objects"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security on media_folder_files (same shape as storage_objects_org_isolation).
-- NULLIF(..., '') because current_setting(name, true) is the empty string on a connection
-- that ever held a transaction-local value. FORCE applies the policy to the table owner,
-- which is the application role.
ALTER TABLE "media_folder_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media_folder_files" FORCE ROW LEVEL SECURITY;
CREATE POLICY "media_folder_files_org_isolation" ON "media_folder_files"
  USING      ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on');

COMMIT;
