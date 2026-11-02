import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  DoctorCheckRegistry,
  type DoctorCheck,
  type DoctorCheckOutcome,
} from '@marinoscar/platform-api/doctor';

import { legacyStorageEnvPresent } from '../../platform/storage/storage-env-import';

// =============================================================================
// Doctor check: leftover storage environment variables (issue #84, E6.1)
// =============================================================================
//
// Object storage is runtime configuration now (/admin/settings/storage); the
// legacy variables are imported once at boot and never read again. A deployment
// that still carries them holds a live secret in a file nothing reads, and an
// operator who edits them expecting an effect is misled. This check WARNS while a
// real bucket (or an endpoint) is still set. It reads the process environment
// only: no database access, no write, and the output names variables, never values.
// =============================================================================

export const STORAGE_ENV_CHECK_ID = 'vault.storage_env';

const NAMES = ['STORAGE_PROVIDER', 'S3_BUCKET', 'S3_REGION', 'S3_ENDPOINT', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] as const;

/** The rule, separated from the environment so a test can drive it. */
export function decideStorageEnv(env: Record<string, string | undefined>): DoctorCheckOutcome {
  if (!legacyStorageEnvPresent(env)) {
    return { status: 'pass', detail: 'No legacy storage environment variables are set', data: { legacyVariables: '' } };
  }
  const set = NAMES.filter((name) => (env[name] ?? '').trim() !== '');
  return {
    status: 'warn',
    detail:
      'Legacy storage variables are still set but are not read: object storage is configured at /admin/settings/storage',
    remedy:
      'Run `npm run vault:migrate-storage-config` if the runtime storage settings are empty, then remove STORAGE_PROVIDER, S3_BUCKET, S3_REGION, S3_ENDPOINT, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from .env (docs/runbooks/storage-config-migration.md)',
    data: { legacyVariables: set.join(', ') },
  };
}

@Injectable()
export class VaultStorageEnvDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = STORAGE_ENV_CHECK_ID;
  readonly category = 'core';
  readonly label = 'Legacy storage variables';

  constructor(private readonly registry: DoctorCheckRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    return decideStorageEnv(process.env);
  }
}
