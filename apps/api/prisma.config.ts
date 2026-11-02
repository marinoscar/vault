import { defineConfig } from '@prisma/config';

/**
 * Prisma configuration for v7+.
 *
 * DATABASE_URL is constructed by scripts/prisma-env.js from the individual
 * POSTGRES_* variables and injected before the Prisma CLI runs. At runtime,
 * PrismaService builds the connection with src/common/database-url.ts.
 *
 * `prisma/schema/` is the GENERATED folder: `npm run db:compose` composes the
 * @marinoscar/platform-db fragments with this app's `prisma/fragments/*.prisma`.
 * Edit a fragment, never the folder. With a schema folder Prisma would look for
 * migrations inside it, so `migrations.path` must stay explicit.
 *
 * SHADOW_DATABASE_URL names the empty database `platform db drift` replays the
 * history into.
 *
 * Paths resolve relative to this file.
 */
export default defineConfig({
  schema: 'prisma/schema',
  datasource: {
    url: process.env.DATABASE_URL as string,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node --project prisma/tsconfig.json --transpile-only prisma/seed.ts',
  },
});
