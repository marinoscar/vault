-- Add unique constraint on secret name per user
CREATE UNIQUE INDEX "secrets_name_created_by_id_key" ON "secrets"("name", "created_by_id");
