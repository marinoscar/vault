/**
 * Builds the PostgreSQL connection string from the individual POSTGRES_*
 * variables (or returns DATABASE_URL untouched when set). User and password
 * are URL-encoded. scripts/prisma-env.js keeps a CommonJS copy of this rule.
 */
export interface DatabaseEnv {
  DATABASE_URL?: string;
  POSTGRES_HOST?: string;
  POSTGRES_PORT?: string;
  POSTGRES_USER?: string;
  POSTGRES_PASSWORD?: string;
  POSTGRES_DB?: string;
  POSTGRES_SSL?: string;
}

export function buildDatabaseUrl(
  env: DatabaseEnv = process.env as DatabaseEnv,
): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;

  const host = env.POSTGRES_HOST || 'localhost';
  const port = env.POSTGRES_PORT || '5432';
  const user = encodeURIComponent(env.POSTGRES_USER || 'postgres');
  const password = encodeURIComponent(env.POSTGRES_PASSWORD || 'postgres');
  const dbName = env.POSTGRES_DB || 'appdb';
  const sslParam = env.POSTGRES_SSL === 'true' ? '?sslmode=require' : '';

  return `postgresql://${user}:${password}@${host}:${port}/${dbName}${sslParam}`;
}
