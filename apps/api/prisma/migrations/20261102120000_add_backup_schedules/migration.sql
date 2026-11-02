-- CreateTable
CREATE TABLE "backup_schedules" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "frequency" TEXT NOT NULL DEFAULT 'daily',
    "interval_hours" INTEGER,
    "time_of_day" TEXT NOT NULL DEFAULT '03:00',
    "day_of_week" INTEGER,
    "day_of_month" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "keep_count" INTEGER NOT NULL DEFAULT 7,
    "include_attachments" BOOLEAN NOT NULL DEFAULT true,
    "include_versions" BOOLEAN NOT NULL DEFAULT false,
    "password_encrypted" TEXT,
    "password_updated_at" TIMESTAMPTZ,
    "next_run_at" TIMESTAMPTZ,
    "last_run_at" TIMESTAMPTZ,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "backup_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_runs" (
    "id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "triggered_by_id" UUID,
    "storage_key" TEXT,
    "size_bytes" BIGINT,
    "user_count" INTEGER NOT NULL DEFAULT 0,
    "secret_count" INTEGER NOT NULL DEFAULT 0,
    "attachment_count" INTEGER NOT NULL DEFAULT 0,
    "warning_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backup_schedules_updated_by_id_idx" ON "backup_schedules"("updated_by_id");

-- CreateIndex
CREATE INDEX "backup_runs_status_started_at_idx" ON "backup_runs"("status", "started_at");

-- CreateIndex
CREATE INDEX "backup_runs_triggered_by_id_idx" ON "backup_runs"("triggered_by_id");

-- AddForeignKey
ALTER TABLE "backup_schedules" ADD CONSTRAINT "backup_schedules_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_triggered_by_id_fkey" FOREIGN KEY ("triggered_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
