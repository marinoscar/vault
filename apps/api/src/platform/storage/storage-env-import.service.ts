// =============================================================================
// Boot-time import of the legacy storage environment (issue #84, E6.1)
// =============================================================================
//
// An upgrade replaces the env-configured S3 provider with the platform's
// runtime-configured one. So a deployment does not lose its bucket between the
// deploy and an administrator's first visit to /admin/settings/storage, the API
// runs `importStorageConfig` (the same function as `npm run
// vault:migrate-storage-config -- --apply`) ONCE at boot, and only when:
//
//   * the environment still names a real bucket and both access keys, and
//   * the runtime configuration does not already hold a different bucket / secret.
//
// It never overwrites runtime configuration (a conflict is logged and left
// alone), is idempotent (a second boot reports `already-configured`), and never
// fails the boot: any error is logged with its stage name only. It writes
// nothing when the variables are gone, which is where the deployment ends up
// once the runbook's cleanup step is done. Not run in worker-only processes
// (`JOBS_WORKER_MODE=off` still imports: the API and the worker share the image).
//
// This is NOT an environment-variable fallback: nothing reads the variables
// after the import; the runtime configuration is the only source of truth.
// =============================================================================

import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { CredentialsService } from '@marinoscar/platform-api/credentials';
import { StorageConfigService } from '@marinoscar/platform-api/storage';

import { PrismaService } from '../../prisma/prisma.service';
import {
  StorageImportError,
  importStorageConfig,
  legacyStorageEnvPresent,
} from './storage-env-import';

@Injectable()
export class StorageEnvImportService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StorageEnvImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
    private readonly storageConfig: StorageConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!legacyStorageEnvPresent(process.env)) return;
    try {
      const report = await importStorageConfig(
        { prisma: this.prisma as never, credentials: this.credentials },
        process.env,
        { apply: true },
      );
      switch (report.outcome) {
        case 'imported':
          // Drop the 5 s cache and re-read, so the synchronous `getBucket()` snapshot the
          // backup routes consult reflects the import at once.
          this.storageConfig.invalidateCache();
          await this.storageConfig.resolve({ fresh: true }).catch(() => undefined);
          this.logger.log(
            `Imported the storage configuration from the environment (driver ${report.driver}, bucket ${report.bucket}). ` +
              'Remove STORAGE_PROVIDER, S3_BUCKET, S3_REGION, S3_ENDPOINT, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from .env: they are not read any more.',
          );
          break;
        case 'already-configured':
          this.logger.warn(
            'Storage is configured at runtime; the legacy S3_* / AWS_* variables are ignored. Remove them from .env.',
          );
          break;
        case 'conflict':
          this.logger.warn(
            'The legacy storage variables differ from the runtime storage configuration, which wins and was left alone. Remove the variables.',
          );
          break;
        case 'incomplete':
          this.logger.warn(
            'The legacy storage variables lack AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY, so they were not imported. Enter the configuration at /admin/settings/storage.',
          );
          break;
        default:
          break;
      }
    } catch (error) {
      // The stage name only: a driver message can echo parameters.
      const stage = error instanceof StorageImportError ? error.stage : (error as Error)?.name ?? 'Error';
      this.logger.warn(`The legacy storage variables could not be imported (${stage}). Enter the configuration at /admin/settings/storage.`);
    }
  }
}
