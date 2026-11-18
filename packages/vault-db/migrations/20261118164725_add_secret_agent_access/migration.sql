-- CreateEnum
CREATE TYPE "secret_agent_access" AS ENUM ('none', 'fill');

-- AlterTable
ALTER TABLE "secrets" ADD COLUMN     "agent_access" "secret_agent_access" NOT NULL DEFAULT 'none',
ADD COLUMN     "agent_access_changed_at" TIMESTAMPTZ;
