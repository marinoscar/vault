import { identityConfiguration } from '@marinoscar/platform-api/identity';

import { buildDatabaseUrl } from '../common/database-url';
import { resolveServiceName } from '../common/otel/telemetry-identity';

export default () => {
  // Construct DATABASE_URL from individual PostgreSQL variables
  const host = process.env.POSTGRES_HOST || 'localhost';
  const port = process.env.POSTGRES_PORT || '5432';
  const user = process.env.POSTGRES_USER || 'postgres';
  const password = process.env.POSTGRES_PASSWORD || 'postgres';
  const dbName = process.env.POSTGRES_DB || 'appdb';
  const ssl = process.env.POSTGRES_SSL === 'true';
  // URL-encoded by the shared builder. DATABASE_URL is deliberately NOT written
  // back to process.env: PrismaService and prisma-env.js derive it themselves.
  const databaseUrl = buildDatabaseUrl();

  return {
    // Application
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    appUrl: process.env.APP_URL || 'https://vault.dev.marin.cr',

    // Database
    database: {
      host,
      port: parseInt(port, 10),
      user,
      password,
      name: dbName,
      ssl,
      url: databaseUrl,
    },

  // Identity: `jwt`, `auth`, `google`, `initialAdminEmail`, `deviceAuth` and
  // `tenancy`, built from the same environment variables Vault always used
  // (JWT_SECRET, GOOGLE_CLIENT_ID, INITIAL_ADMIN_EMAIL, DEVICE_CODE_*, ...).
  ...identityConfiguration(process.env),

  // Observability
  otel: {
    enabled: process.env.OTEL_ENABLED === 'true',
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    serviceName: resolveServiceName(),
  },

  // GreptimeDB: the telemetry store's SQL read side (E9.2, #90).
  //
  // THE DEPLOYMENT DEFAULT, not the only source. An administrator can save a
  // connection at /admin/settings/telemetry (a `telemetry_connection` system-settings
  // row plus two passwords in the encrypted credential store); when one is stored it
  // is used WHOLLY in place of this block. `TelemetryConnectionService` is the one
  // resolver; nothing else reads this block. The writer login and the HTTP port are
  // the collector's, never the API's. Credentials default to '' (no guessable default).
  // `available` means "this default names a usable reader connection".
  greptime: {
    host: process.env.GREPTIME_HOST || '',
    pgPort: parseInt(process.env.GREPTIME_PG_PORT || '4003', 10),
    database: process.env.GREPTIME_DB || 'public',
    readerUser: process.env.GREPTIME_READER_USER || '',
    readerPassword: process.env.GREPTIME_READER_PASSWORD || '',
    adminUser: process.env.GREPTIME_ADMIN_USER || '',
    adminPassword: process.env.GREPTIME_ADMIN_PASSWORD || '',
    available: Boolean(
      process.env.GREPTIME_HOST &&
        process.env.GREPTIME_READER_USER &&
        process.env.GREPTIME_READER_PASSWORD,
    ),
  },

  // stack-agent: the VPS sidecar that can start the telemetry services on request.
  // Deployment infrastructure (both default to '': the feature reports
  // `not_configured`, the normal state on a development machine). The token is read
  // only by `StackAgentClient` and never logged.
  stackAgent: {
    url: (process.env.STACK_AGENT_URL || '').trim(),
    token: (process.env.STACK_AGENT_TOKEN || '').trim(),
  },

  // Storage Configuration
  storage: {
    provider: process.env.STORAGE_PROVIDER || 's3',
    s3: {
      bucket: process.env.S3_BUCKET || '',
      region: process.env.S3_REGION || 'us-east-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      endpoint: process.env.S3_ENDPOINT || undefined,
    },
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10737418240', 10), // 10GB default
    allowedMimeTypes: (
      process.env.ALLOWED_MIME_TYPES || 'image/*,application/pdf,video/*'
    ).split(','),
    signedUrlExpiry: parseInt(process.env.SIGNED_URL_EXPIRY || '3600', 10), // 1 hour default
    partSize: parseInt(process.env.STORAGE_PART_SIZE || '10485760', 10), // 10MB default
  },

  logLevel: process.env.LOG_LEVEL || 'info',

  // Vault Encryption
  vault: {
    encryptionKey: process.env.VAULT_ENCRYPTION_KEY || '',
  },
  };
};
