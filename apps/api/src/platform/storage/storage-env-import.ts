// =============================================================================
// Import the legacy storage environment into the runtime configuration
// (issue #84, E6.1, epic #61)
// =============================================================================
//
// Until E6.1 Vault's object store was configured by environment variables:
//
//   STORAGE_PROVIDER   (only `s3`)
//   S3_BUCKET  S3_REGION  S3_ENDPOINT
//   AWS_ACCESS_KEY_ID  AWS_SECRET_ACCESS_KEY
//
// The platform storage slice reads NONE of them: the driver and its non-secret
// settings are the `storage` namespace of the `global` system-settings row and
// the secret access key is the credential `storage` / `default`, encrypted with
// SECRETS_ENCRYPTION_KEY. This module is the one-time, idempotent move, kept free
// of Nest and of the command line so tests can drive it with fakes. Two callers:
//
//   * `npm run vault:migrate-storage-config` (dry run by default, `--apply`), and
//   * `StorageEnvImportService`, which runs it ONCE at boot while the runtime
//     configuration is still empty, so an upgrade does not drop the bucket
//     between the deploy and an operator's first visit to the admin page.
//
// The mapping: `S3_ENDPOINT` set -> the `s3compatible` driver (MinIO, LocalStack,
// R2 by endpoint ...; path-style addressing, which the legacy provider always
// forced when an endpoint was set); otherwise the `s3` driver. The region
// defaults to `us-east-1`, the legacy default.
//
// RULES
//   * Runtime configuration WINS. Nothing already configured is overwritten: a
//     different bucket or a different stored secret is a `conflict` and nothing
//     changes. The same bucket and the same secret is `already-configured`.
//   * The secret is stored FIRST and read back before the settings are written,
//     so a failure leaves the deployment exactly as it was (or with a stored
//     secret that a rerun reuses).
//   * A static key pair is required (the platform driver does not use the AWS
//     default credential chain). Without both keys the outcome is `incomplete`
//     and nothing is written.
//   * The settings write is optimistic on the row's `version`, so an admin saving
//     the storage page at the same moment is detected, not overwritten.
//   * NEVER output the secret access key. The report is booleans, an outcome and
//     the non-secret bucket / provider; errors name a stage, never a value.
// =============================================================================

import type { CredentialsService } from '@marinoscar/platform-api/credentials';

export const STORAGE_CREDENTIAL_PURPOSE = 'storage';
export const STORAGE_CREDENTIAL_NAME = 'default';
export const STORAGE_IMPORT_AUDIT_ACTION = 'storage.config.imported';

const SETTINGS_KEY = 'global';
const DEFAULT_REGION = 'us-east-1';

/** Placeholders the shipped `.env.example` carried: not a bucket. */
const PLACEHOLDER_BUCKETS = new Set(['your-bucket-name', 'your-bucket', 'your-s3-bucket-name']);

export interface LegacyStorageEnv {
  /** The runtime driver the variables map to. */
  driver: 's3' | 's3compatible';
  bucket: string;
  region: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** The environment variables this module reads (a subset of `process.env`). */
export const LEGACY_STORAGE_ENV_KEYS = [
  'STORAGE_PROVIDER',
  'S3_BUCKET',
  'S3_REGION',
  'S3_ENDPOINT',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
] as const;

const clean = (value: string | undefined): string => (value ?? '').trim();

/**
 * The legacy variables as a configuration, or `null` when the environment names
 * no bucket (unset, empty or the `.env.example` placeholder): there is nothing
 * to import.
 */
export function readLegacyStorageEnv(env: Record<string, string | undefined>): LegacyStorageEnv | null {
  const bucket = clean(env.S3_BUCKET);
  if (!bucket || PLACEHOLDER_BUCKETS.has(bucket)) return null;
  const endpoint = clean(env.S3_ENDPOINT);
  return {
    driver: endpoint ? 's3compatible' : 's3',
    bucket,
    region: clean(env.S3_REGION) || DEFAULT_REGION,
    endpoint,
    accessKeyId: clean(env.AWS_ACCESS_KEY_ID),
    secretAccessKey: clean(env.AWS_SECRET_ACCESS_KEY),
  };
}

/**
 * True when the environment still carries a legacy storage configuration (a real
 * bucket, or an endpoint): the Doctor warns while it does. `AWS_*` alone does not
 * count; the email slice's SES fallback may still read them.
 */
export function legacyStorageEnvPresent(env: Record<string, string | undefined>): boolean {
  return readLegacyStorageEnv(env) !== null || clean(env.S3_ENDPOINT) !== '';
}

/** The driver's non-secret settings in the stored shape of the `storage` namespace. */
export function toDriverSettings(legacy: LegacyStorageEnv): Record<string, unknown> {
  return {
    bucket: legacy.bucket,
    region: legacy.region,
    endpoint: legacy.endpoint,
    accessKeyId: legacy.accessKeyId,
    forcePathStyle: null,
  };
}

export type StorageImportOutcome =
  /** The environment names no bucket. */
  | 'nothing-to-import'
  /** Dry run: an apply would store the credential and write the settings. */
  | 'would-import'
  /** Apply: the credential is stored and the settings are written. */
  | 'imported'
  /** The runtime configuration already holds this bucket and secret. */
  | 'already-configured'
  /** The environment names a bucket but not both access keys; nothing was changed. */
  | 'incomplete'
  /** The runtime configuration holds a different bucket or secret; nothing was changed. */
  | 'conflict';

/** What a run did. Booleans, an outcome and the non-secret bucket only. */
export interface StorageImportReport {
  apply: boolean;
  outcome: StorageImportOutcome;
  driver: string | null;
  bucket: string | null;
  /** The runtime `storage` settings already name a bucket (before the run). */
  settingsConfigured: boolean;
  /** The credential store already holds a secret at `storage` / `default` (before the run). */
  credentialPresent: boolean;
  /** Which of the six variables are set (names only). */
  envVarsSet: string[];
}

/** A failed stage. The message names the stage and never carries a value. */
export class StorageImportError extends Error {
  constructor(
    readonly stage: 'store-credential' | 'verify-credential' | 'settings-row-missing' | 'write-settings' | 'concurrent-write',
    message: string,
  ) {
    super(message);
    this.name = 'StorageImportError';
  }
}

/** The slice of the Prisma client the import touches. */
export interface StorageImportPrisma {
  systemSettings: {
    findUnique(args: { where: { key: string } }): Promise<{ id: string; value: unknown; version: number } | null>;
    updateMany(args: {
      where: { key: string; version: number };
      data: { value: unknown; version: { increment: number } };
    }): Promise<{ count: number }>;
  };
  auditEvent: {
    create(args: { data: { action: string; targetType: string; targetId: string; meta: unknown } }): Promise<unknown>;
  };
}

export interface StorageImportDeps {
  prisma: StorageImportPrisma;
  credentials: Pick<CredentialsService, 'describe' | 'getSecret' | 'setSecret'>;
}

interface StoredStorage {
  provider?: unknown;
  bucket?: unknown;
  drivers?: Record<string, Record<string, unknown> | undefined>;
  [key: string]: unknown;
}

/** The bucket the stored `storage` namespace names for its active driver (flat aliases included). */
function storedBucket(stored: StoredStorage | undefined): string {
  if (!stored || typeof stored !== 'object') return '';
  const provider = typeof stored.provider === 'string' && stored.provider ? stored.provider : 's3';
  const fromDriver = stored.drivers?.[provider]?.bucket;
  if (typeof fromDriver === 'string' && fromDriver) return fromDriver;
  return typeof stored.bucket === 'string' ? stored.bucket : '';
}

export async function importStorageConfig(
  deps: StorageImportDeps,
  env: Record<string, string | undefined>,
  options: { apply: boolean },
): Promise<StorageImportReport> {
  const { prisma, credentials } = deps;
  const { apply } = options;
  const envVarsSet = LEGACY_STORAGE_ENV_KEYS.filter((key) => clean(env[key]) !== '');
  const legacy = readLegacyStorageEnv(env);

  const row = await prisma.systemSettings.findUnique({ where: { key: SETTINGS_KEY } });
  const stored = (row?.value as { storage?: StoredStorage } | null)?.storage;
  const runtimeBucket = storedBucket(stored);
  const existing = await credentials.describe(STORAGE_CREDENTIAL_PURPOSE, STORAGE_CREDENTIAL_NAME);

  const base = {
    apply,
    driver: legacy?.driver ?? null,
    bucket: legacy?.bucket ?? null,
    settingsConfigured: runtimeBucket !== '',
    credentialPresent: existing !== null,
    envVarsSet: [...envVarsSet],
  };

  if (!legacy) return { ...base, outcome: 'nothing-to-import' };
  if (!legacy.accessKeyId || !legacy.secretAccessKey) return { ...base, outcome: 'incomplete' };

  // Runtime configuration wins: a different bucket or secret is never overwritten.
  if (runtimeBucket !== '' && runtimeBucket !== legacy.bucket) return { ...base, outcome: 'conflict' };
  let secretMatches = false;
  if (existing) {
    secretMatches = (await credentials.getSecret(STORAGE_CREDENTIAL_PURPOSE, STORAGE_CREDENTIAL_NAME)) === legacy.secretAccessKey;
    if (!secretMatches) return { ...base, outcome: 'conflict' };
  }
  const settingsDone = runtimeBucket === legacy.bucket;
  if (settingsDone && secretMatches) return { ...base, outcome: 'already-configured' };

  if (!apply) return { ...base, outcome: 'would-import' };

  if (!row) {
    throw new StorageImportError(
      'settings-row-missing',
      'The system settings row does not exist yet (run prisma:seed first). Nothing was changed.',
    );
  }

  if (!secretMatches) {
    try {
      await credentials.setSecret(STORAGE_CREDENTIAL_PURPOSE, STORAGE_CREDENTIAL_NAME, legacy.secretAccessKey, {
        label: 'Storage secret access key',
      });
    } catch {
      throw new StorageImportError(
        'store-credential',
        'The credential store refused the key (is SECRETS_ENCRYPTION_KEY set and valid?). Nothing was changed.',
      );
    }
    const readBack = await credentials.getSecret(STORAGE_CREDENTIAL_PURPOSE, STORAGE_CREDENTIAL_NAME);
    if (readBack !== legacy.secretAccessKey) {
      throw new StorageImportError(
        'verify-credential',
        'The stored credential did not read back as the same key. The settings were NOT written.',
      );
    }
  }

  if (!settingsDone) {
    const value = (row.value ?? {}) as Record<string, unknown>;
    const previous = (value.storage ?? {}) as StoredStorage;
    const drivers = { ...(previous.drivers ?? {}), [legacy.driver]: toDriverSettings(legacy) };
    const next = { ...value, storage: { ...previous, provider: legacy.driver, drivers } };
    let updated: { count: number };
    try {
      updated = await prisma.systemSettings.updateMany({
        where: { key: SETTINGS_KEY, version: row.version },
        data: { value: next, version: { increment: 1 } },
      });
    } catch {
      throw new StorageImportError(
        'write-settings',
        'The storage settings could not be written. The credential is stored; rerun to finish.',
      );
    }
    if (updated.count !== 1) {
      throw new StorageImportError(
        'concurrent-write',
        'The settings row changed while importing. The credential is stored; rerun to finish.',
      );
    }
  }

  await prisma.auditEvent.create({
    data: {
      action: STORAGE_IMPORT_AUDIT_ACTION,
      targetType: 'credential',
      targetId: `${STORAGE_CREDENTIAL_PURPOSE}/${STORAGE_CREDENTIAL_NAME}`,
      // No key: the fact of the move, the driver and the (non-secret) bucket.
      meta: { from: 'environment', to: 'system_settings.storage + credentials', driver: legacy.driver, bucket: legacy.bucket },
    },
  });

  return { ...base, outcome: 'imported', settingsConfigured: true, credentialPresent: true };
}

/** One printable line per fact; booleans, names and the non-secret bucket only. */
export function formatStorageImportReport(report: StorageImportReport): string[] {
  const lines = [
    `mode: ${report.apply ? 'APPLY' : 'dry run (pass --apply to change anything)'}`,
    `legacy variables set: ${report.envVarsSet.length ? report.envVarsSet.join(', ') : '(none)'}`,
  ];
  if (report.bucket) lines.push(`legacy bucket: ${report.bucket} (driver ${report.driver})`);
  lines.push(
    `runtime storage settings name a bucket: ${report.settingsConfigured ? 'yes' : 'no'}`,
    `credential ${STORAGE_CREDENTIAL_PURPOSE}/${STORAGE_CREDENTIAL_NAME}: ${report.credentialPresent ? 'present' : 'absent'}`,
    `outcome: ${report.outcome}`,
  );
  if (report.outcome === 'incomplete') {
    lines.push('AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are both required: enter the configuration at /admin/settings/storage.');
  }
  if (report.outcome === 'conflict') {
    lines.push('The runtime configuration differs from the environment and was left alone. Remove the legacy variables, or fix it at /admin/settings/storage.');
  }
  return lines;
}
