import { DynamicModule, Module, type ModuleMetadata, type Provider, type Type } from '@nestjs/common';

import { AiStatusController } from './ai/ai-status.controller';
import { CardExtractController } from './ai/card-extract.controller';
import { CardExtractService } from './ai/card-extract.service';
import { BackupArchiveService } from './backups/backup-archive.service';
import { BackupNotifier } from './backups/backup-notifier.service';
import { BackupQueueService } from './backups/backup-queue.service';
import { BackupRunnerService } from './backups/backup-runner.service';
import { BackupScheduleTask } from './backups/backup-schedule.task';
import { BackupsController } from './backups/backups.controller';
import { BackupsService } from './backups/backups.service';
import { BackupRunHandler } from './backups/jobs/backup-run.handler';
import { UserBackupRunHandler } from './backups/jobs/user-backup-run.handler';
import { MyBackupsController } from './backups/my-backups.controller';
import { MyBackupsService } from './backups/my-backups.service';
import { CardExpiryScanHandler } from './card-expiry/card-expiry-scan.handler';
import { CardExpiryTask } from './card-expiry/card-expiry.task';
import { MediaController } from './media/media.controller';
import { MediaService } from './media/media.service';
import { SecretTypesController } from './secret-types/secret-types.controller';
import { SecretTypesService } from './secret-types/secret-types.service';
import { CardSummaryService } from './secrets/card-summary.service';
import { SecretsExportService } from './secrets/export/secrets-export.service';
import { SecretsController } from './secrets/secrets.controller';
import { SecretsService } from './secrets/secrets.service';
import {
  VAULT_AI,
  VAULT_AI_CONFIG,
  VAULT_AI_KEY_PRESENCE,
  VAULT_AUDIT,
  VAULT_CRYPTO,
  VAULT_JOBS,
  VAULT_METRICS,
  VAULT_NOTIFY,
  VAULT_OBJECT_STORE,
  VAULT_OBJECTS,
  VAULT_PRISMA,
  VAULT_SETTINGS,
} from './ports';

/** Binds a port to a class Nest instantiates. */
export interface VaultClassBinding {
  useClass: Type<unknown>;
}
/** Binds a port to a provider that already exists (a class or a token). */
export interface VaultExistingBinding {
  useExisting: Type<unknown> | string | symbol;
}
/** Binds a port to a ready value. */
export interface VaultValueBinding {
  useValue: unknown;
}
/** Binds a port to a factory. */
export interface VaultFactoryBinding {
  useFactory: (...deps: any[]) => unknown;
  inject?: Array<Type<unknown> | string | symbol>;
}
/** How a host binds one port. */
export type VaultPortBinding = VaultClassBinding | VaultExistingBinding | VaultValueBinding | VaultFactoryBinding;

/**
 * The ports a host binds. Everything except `metrics` is required: a slice that finds its port
 * missing fails at bootstrap, not on first use. `metrics` is optional (a host without telemetry
 * binds nothing and the slices emit nothing).
 *
 * @stability experimental
 */
export interface VaultApiBindings {
  /** The host's Prisma client (see `VAULT_PRISMA`). */
  prisma: VaultPortBinding;
  /** The secret-value cipher (`VAULT_CRYPTO`). */
  crypto: VaultPortBinding;
  /** The raw object-storage provider (`VAULT_OBJECT_STORE`). */
  objectStore: VaultPortBinding;
  /** The storage objects service (`VAULT_OBJECTS`). */
  objects: VaultPortBinding;
  /** The job queue and handler registry (`VAULT_JOBS`). */
  jobs: VaultPortBinding;
  /** The notification dispatcher (`VAULT_NOTIFY`). */
  notify: VaultPortBinding;
  /** The platform AI slice (`VAULT_AI`). */
  ai: VaultPortBinding;
  /** The public AI configuration (`VAULT_AI_CONFIG`). */
  aiConfig: VaultPortBinding;
  /** Whether a deployment AI key is stored (`VAULT_AI_KEY_PRESENCE`). */
  aiKeyPresence: VaultPortBinding;
  /** The audit trail (`VAULT_AUDIT`). */
  audit: VaultPortBinding;
  /** The system settings (`VAULT_SETTINGS`). */
  settings: VaultPortBinding;
  /** Vault's metrics (`VAULT_METRICS`); optional. */
  metrics?: VaultPortBinding;
}

/** Options of {@link VaultApiModule.forRoot}. */
export interface VaultApiOptions {
  /** The port bindings. */
  bindings: VaultApiBindings;
  /**
   * Modules the bindings and the controllers' guards need (the storage providers, the AI module
   * that exports `AiEnabledGuard`, the credentials module, ...).
   */
  imports?: ModuleMetadata['imports'];
}

const TOKENS: ReadonlyArray<[keyof VaultApiBindings, symbol]> = [
  ['prisma', VAULT_PRISMA],
  ['crypto', VAULT_CRYPTO],
  ['objectStore', VAULT_OBJECT_STORE],
  ['objects', VAULT_OBJECTS],
  ['jobs', VAULT_JOBS],
  ['notify', VAULT_NOTIFY],
  ['ai', VAULT_AI],
  ['aiConfig', VAULT_AI_CONFIG],
  ['aiKeyPresence', VAULT_AI_KEY_PRESENCE],
  ['audit', VAULT_AUDIT],
  ['settings', VAULT_SETTINGS],
  ['metrics', VAULT_METRICS],
];

function toProvider(provide: symbol, binding: VaultPortBinding): Provider {
  return { provide, ...binding } as Provider;
}

/**
 * The Vault domain: secrets, secret types, attachments, the export zip, backups, media and card
 * extraction, behind ports. A host mounts it once with {@link VaultApiModule.forRoot}:
 *
 * ```ts
 * VaultApiModule.forRoot({ bindings: { prisma: { useExisting: PrismaService }, ... }, imports: [...] })
 * ```
 *
 * The controllers are the package's (routes, permissions and wire shapes are unchanged); the host
 * adds only what has no meaning outside this deployment.
 *
 * @stability experimental
 */
@Module({})
export class VaultApiModule {
  static forRoot(options: VaultApiOptions): DynamicModule {
    const ports = TOKENS.flatMap(([key, token]) => {
      const binding = options.bindings[key];
      return binding ? [toProvider(token, binding)] : [];
    });
    return {
      module: VaultApiModule,
      imports: options.imports ?? [],
      controllers: [
        SecretTypesController,
        SecretsController,
        MediaController,
        AiStatusController,
        CardExtractController,
        BackupsController,
        MyBackupsController,
      ],
      providers: [
        ...ports,
        SecretTypesService,
        SecretsService,
        SecretsExportService,
        CardSummaryService,
        MediaService,
        CardExtractService,
        BackupsService,
        MyBackupsService,
        BackupArchiveService,
        BackupQueueService,
        BackupNotifier,
        BackupRunnerService,
        BackupScheduleTask,
        BackupRunHandler,
        UserBackupRunHandler,
        CardExpiryScanHandler,
        CardExpiryTask,
      ],
      exports: [
        ...TOKENS.filter(([key]) => options.bindings[key]).map(([, token]) => token),
        SecretsService,
        SecretsExportService,
        SecretTypesService,
        MediaService,
      ],
    };
  }
}
