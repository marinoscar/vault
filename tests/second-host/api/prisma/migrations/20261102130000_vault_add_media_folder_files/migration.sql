-- =============================================================================
-- Move storage_objects.media_folder_id into media_folder_files (E2.2, #74)
-- =============================================================================
--
-- The platform's StorageObject has no media_folder_id column and an app cannot
-- add a column to a platform table, so a file's media folder becomes its own
-- row: media_folder_files (object_id, org_id, media_folder_id), one per object,
-- with a composite foreign key that includes org_id (every link to an org-owned
-- table does).
--
-- Must sort AFTER the installed platform migrations: it needs
-- storage_objects.org_id and UNIQUE (id, org_id) from 0025_org_scoped_rls.
--
-- Behaviour kept: deleting a folder used to set media_folder_id to NULL
-- (ON DELETE SET NULL); deleting the link row when the folder goes is the same
-- ("no folder"), and deleting the object deletes its link.
--
-- The backfill reads storage_objects, an RLS table, so it runs with
-- app.rls_bypass set for the transaction (set_config(..., true)); without it the
-- INSERT .. SELECT would silently see zero rows as a non-superuser role.
--
-- media_folder_files carries org_id but has NO row-level-security policy yet:
-- it is only reachable through storage_objects (composite foreign key) and
-- media_folders (owner-checked in code). The policy comes with the application
-- role switch (E2.3) / the storage slice (E6); see
-- docs/platform-adoption/local-exceptions.md.
-- =============================================================================

BEGIN;
SELECT set_config('app.rls_bypass', 'on', true);

-- CreateTable
CREATE TABLE "media_folder_files" (
    "object_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "media_folder_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_folder_files_pkey" PRIMARY KEY ("object_id")
);

-- CreateIndex
CREATE INDEX "media_folder_files_media_folder_id_idx" ON "media_folder_files"("media_folder_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_folder_files_object_id_org_id_key" ON "media_folder_files"("object_id", "org_id");

-- AddForeignKey
ALTER TABLE "media_folder_files" ADD CONSTRAINT "media_folder_files_object_id_org_id_fkey" FOREIGN KEY ("object_id", "org_id") REFERENCES "storage_objects"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_folder_files" ADD CONSTRAINT "media_folder_files_media_folder_id_fkey" FOREIGN KEY ("media_folder_id") REFERENCES "media_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every object that was in a folder keeps its folder.
INSERT INTO "media_folder_files" ("object_id", "org_id", "media_folder_id")
SELECT "id", "org_id", "media_folder_id"
FROM "storage_objects"
WHERE "media_folder_id" IS NOT NULL;

-- Contract: the column, its index and its foreign key go.
ALTER TABLE "storage_objects" DROP CONSTRAINT "storage_objects_media_folder_id_fkey";
DROP INDEX "storage_objects_media_folder_id_idx";
ALTER TABLE "storage_objects" DROP COLUMN "media_folder_id";

COMMIT;
