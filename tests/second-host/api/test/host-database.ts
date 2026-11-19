// =============================================================================
// Host Beta's database, built the way a fresh deployment builds it (docs/EMBEDDING.md, "Database")
// =============================================================================
//
//   1. as the bootstrap superuser: an ORDINARY application role (NOSUPERUSER NOBYPASSRLS) owning a
//      new database and its public schema, plus the `uuid-ossp` extension;
//   2. as the ROLE: `prisma migrate deploy` over the host's committed history (the platform's
//      migrations, then the `vault-db sync` copies, then the host's own);
//   3. `vault-db check --database`: the raw-SQL objects Prisma cannot express are there;
//   4. the seed: `seedPlatform` with the host's permission catalog (its roles, its permissions and
//      Vault's mapped onto its roles), then `seedVaultSystemSecretTypes`.
//
// SECOND_HOST_ADMIN_URL names the superuser connection (`postgresql://postgres:...@localhost:5432/postgres`).
// The database and the role are named `vault_i194_*` and dropped at the end.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { platformPermissionCatalog } from '@marinoscar/platform-api/manifest';
import { composeDefaultSystemSettings } from '@marinoscar/platform-api/settings';
import { platformSeedInputFrom, seedPlatform, type SeedPrisma } from '@marinoscar/platform-db/seed';
import { seedVaultSystemSecretTypes } from '@marinoscar/vault-api/secret-types';

import { PrismaClient } from '../generated/client';
import { PERMISSION_OPTIONS } from '../src/permissions';

const API_ROOT = join(__dirname, '..');
const BIN = join(API_ROOT, '..', '..', '..', 'node_modules', '.bin');

export interface HostDatabase {
  url: string;
  env: Record<string, string>;
  drop(): Promise<void>;
}

/** The superuser connection, or a clear error: this suite needs a real PostgreSQL 16. */
export function adminUrl(): string {
  const url = process.env.SECOND_HOST_ADMIN_URL;
  if (!url) {
    throw new Error('SECOND_HOST_ADMIN_URL is not set: the second-host suite needs a PostgreSQL 16 superuser URL (see tests/second-host/README.md)');
  }
  return url;
}

const withDatabase = (url: string, database: string, user?: string, password?: string) => {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  if (user !== undefined) parsed.username = encodeURIComponent(user);
  if (password !== undefined) parsed.password = encodeURIComponent(password);
  return parsed.toString();
};

export async function provisionHostDatabase(): Promise<HostDatabase> {
  const admin = adminUrl();
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
  const database = `vault_i194_${suffix}`;
  const role = `vault_i194_app_${suffix}`;
  const password = randomBytes(12).toString('hex');

  const maintenance = new Client({ connectionString: admin });
  await maintenance.connect();
  try {
    await maintenance.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS CREATEDB CREATEROLE`);
    await maintenance.query(`CREATE DATABASE "${database}"`);
  } finally {
    await maintenance.end();
  }
  const bootstrap = new Client({ connectionString: withDatabase(admin, database) });
  await bootstrap.connect();
  try {
    await bootstrap.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await bootstrap.query(`ALTER DATABASE "${database}" OWNER TO "${role}"`);
    await bootstrap.query(`ALTER SCHEMA public OWNER TO "${role}"`);
  } finally {
    await bootstrap.end();
  }

  const url = withDatabase(admin, database, role, password);
  const parsed = new URL(url);
  const env = {
    DATABASE_URL: url,
    POSTGRES_HOST: parsed.hostname,
    POSTGRES_PORT: parsed.port || '5432',
    POSTGRES_DB: database,
    POSTGRES_USER: role,
    POSTGRES_PASSWORD: password,
  };
  const drop = async () => {
    const cleanup = new Client({ connectionString: admin });
    try {
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await cleanup.query(`DROP ROLE IF EXISTS "${role}"`);
    } finally {
      await cleanup.end().catch(() => undefined);
    }
  };

  try {
    const childEnv = { ...process.env, ...env };
    execFileSync(join(BIN, 'prisma'), ['migrate', 'deploy'], { cwd: API_ROOT, env: childEnv, stdio: 'pipe' });
    execFileSync(join(BIN, 'vault-db'), ['check', '--database'], { cwd: API_ROOT, env: childEnv, stdio: 'pipe' });
    await seed(url);
  } catch (error) {
    await drop();
    const detail = (error as { stderr?: Buffer }).stderr?.toString() ?? '';
    throw new Error(`Host Beta database setup failed: ${(error as Error).message}\n${detail}`);
  }
  return { url, env, drop };
}

async function seed(url: string): Promise<void> {
  const prisma = new PrismaClient({ adapter: new PrismaPg(url) });
  try {
    const input = platformSeedInputFrom(
      { permissions: platformPermissionCatalog(PERMISSION_OPTIONS), settings: composeDefaultSystemSettings() as Record<string, unknown> },
      process.env,
    );
    await seedPlatform(prisma as unknown as SeedPrisma, input);
    await seedVaultSystemSecretTypes(prisma as never);
  } finally {
    await prisma.$disconnect();
  }
}
