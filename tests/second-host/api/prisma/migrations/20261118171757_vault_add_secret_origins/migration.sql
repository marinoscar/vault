-- AlterTable
ALTER TABLE "secrets" ADD COLUMN     "origins" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateIndex (raw SQL, intentional drift: Prisma ignores a partial index. The predicate holds for every
-- row because the column is NOT NULL, and the planner proves it from `@>` and `&&`, so lookups use the index.)
CREATE INDEX "secrets_origins_gin_idx" ON "secrets" USING GIN ("origins") WHERE "origins" IS NOT NULL;
