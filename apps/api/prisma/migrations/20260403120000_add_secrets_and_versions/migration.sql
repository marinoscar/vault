-- CreateTable
CREATE TABLE "secret_types" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "fields" JSONB NOT NULL,
    "allow_attachments" BOOLEAN NOT NULL DEFAULT false,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "secret_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "secrets" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type_id" UUID NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "secrets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "secret_versions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "secret_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "encrypted_data" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "auth_tag" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_current" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "secret_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "secret_attachments" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "secret_id" UUID NOT NULL,
    "storage_object_id" UUID NOT NULL,
    "label" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "secret_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "secret_types_created_by_id_idx" ON "secret_types"("created_by_id");

-- CreateIndex
CREATE INDEX "secrets_created_by_id_idx" ON "secrets"("created_by_id");

-- CreateIndex
CREATE INDEX "secrets_type_id_idx" ON "secrets"("type_id");

-- CreateIndex
CREATE UNIQUE INDEX "secret_versions_secret_id_version_key" ON "secret_versions"("secret_id", "version");

-- CreateIndex
CREATE INDEX "secret_versions_secret_id_is_current_idx" ON "secret_versions"("secret_id", "is_current");

-- CreateIndex
CREATE UNIQUE INDEX "secret_attachments_secret_id_storage_object_id_key" ON "secret_attachments"("secret_id", "storage_object_id");

-- AddForeignKey
ALTER TABLE "secret_types" ADD CONSTRAINT "secret_types_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "secret_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secret_versions" ADD CONSTRAINT "secret_versions_secret_id_fkey" FOREIGN KEY ("secret_id") REFERENCES "secrets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secret_versions" ADD CONSTRAINT "secret_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secret_attachments" ADD CONSTRAINT "secret_attachments_secret_id_fkey" FOREIGN KEY ("secret_id") REFERENCES "secrets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secret_attachments" ADD CONSTRAINT "secret_attachments_storage_object_id_fkey" FOREIGN KEY ("storage_object_id") REFERENCES "storage_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique index: only one current version per secret
CREATE UNIQUE INDEX "secret_versions_current_unique" ON "secret_versions" ("secret_id") WHERE "is_current" = true;
