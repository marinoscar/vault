-- E5.2 (#82): backups run as queue jobs. A backup run points at the job that runs it.
-- App table only; the platform `jobs` table is referenced, never altered.

-- AlterTable
ALTER TABLE "backup_runs" ADD COLUMN     "job_id" UUID;

-- CreateIndex
CREATE INDEX "backup_runs_job_id_idx" ON "backup_runs"("job_id");

-- AddForeignKey
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One-off sweep. A row still `running` with no job was started by the in-process runner this
-- release removes: nothing will ever finish it. (A run that does finish under the old process
-- during the deploy still overwrites this by id, as it always did.)
UPDATE "backup_runs"
SET "status" = 'failed',
    "error" = 'Interrupted (the server running it stopped)',
    "finished_at" = now()
WHERE "status" = 'running' AND "job_id" IS NULL;
