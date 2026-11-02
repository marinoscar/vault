import { Logger } from '@nestjs/common';
import { registerFactoryResetStep } from '@marinoscar/platform-api/user-data';
import type { FactoryResetStepDef, UserDataDbPort } from '@marinoscar/platform-api/user-data';
import type { StorageProvider } from '@marinoscar/platform-api/storage';

// =============================================================================
// This app's steps of the platform's admin factory reset (issue #91, E9.3, epic #64)
// =============================================================================
//
// `admin.factory_reset` wipes inline owner models per user (Vault's secrets, with their versions and
// attachments by cascade, and the media folders), then every user but the actor, then every storage
// object outside the `survivesFactoryReset` prefixes (it needs a model flagged `storageObjects: true`,
// and the platform's own `StorageObject` hint is one). Two things of Vault's are out of its reach:
//
//   1. LOGICAL BACKUPS. A backup archive is an object key in `backup_runs.storage_key`, not a
//      `storage_objects` row, so the platform's storage step never deletes its bytes, and
//      `backup_runs` is a DELEGATED model (see `user-data.manifest.ts`), which the reset never
//      enqueues. `vault.backups` deletes every archive (user and scheduled system backups alike: an
//      archive is the user's secrets in a zip) and then the run rows. It runs `before-users`, because the
//      user rows' cascade would delete the run rows of a user's backups and strand their bytes.
//   2. CUSTOM SECRET TYPES. A custom type is shared configuration with an optional author, so no
//      per-user pass owns it (and it is not an inline owner model: the platform's orphan sweep would
//      delete the SYSTEM types, whose `created_by_id` is null). `vault.secret-types` deletes the custom
//      types once no secret is left (`deployment` phase, after the orphan sweep); system types stay.
//
// KEPT, and said so on the page: the scheduled-backup configuration (`backup_schedules`: schedule, retention
// and the encrypted archive password), the system secret types, every platform setting and credential.
//
// RETRY SAFETY. Every statement is a `deleteMany` by predicate or a page that selects what is still
// there, so a retried step deletes what is left. A provider failure keeps the row and is counted in
// `archivesFailed`; it never throws.
// =============================================================================

const logger = new Logger('VaultFactoryReset');

/** Backup runs read per page. */
const PAGE = 500;

/** What the backup step needs from the host, which a plain step function cannot inject. */
export interface VaultFactoryResetDeps {
  /** The bypass client port (`USER_DATA_DB`). */
  readonly db: Pick<UserDataDbPort, 'system'>;
  /** The active storage provider. */
  readonly storage: Pick<StorageProvider, 'delete'>;
}

let deps: VaultFactoryResetDeps | undefined;

/** Hands the backup step its host ports (called at bootstrap by `VaultFactoryResetBinding`; a test calls it itself). */
export function bindVaultFactoryResetDeps(next: VaultFactoryResetDeps | undefined): void {
  deps = next;
}

function requireDeps(): VaultFactoryResetDeps {
  if (!deps) {
    throw new Error(
      'vault.backups: the factory reset backup step has no ports; UserDataHostModule must be mounted (VaultFactoryResetBinding).',
    );
  }
  return deps;
}

/** Every logical backup archive (bytes) and then every `backup_runs` row. */
export const VAULT_BACKUPS_STEP: FactoryResetStepDef = {
  id: 'vault.backups',
  phase: 'before-users',
  description: 'Every logical backup archive (My backups and the scheduled system backups): the file, then its record.',
  summary: 'Every logical (password-protected) backup archive, My backups and scheduled ones, and its record',
  async run(): Promise<Record<string, number>> {
    const { db, storage } = requireDeps();
    const system = db.system('purge') as any;
    let archivesDeleted = 0;
    let archivesFailed = 0;
    let runsDeleted = 0;
    let cursor: string | undefined;

    for (;;) {
      const page: { id: string; storageKey: string | null; deletedAt: Date | null }[] = await system.backupRun.findMany({
        where: cursor ? { id: { gt: cursor } } : {},
        select: { id: true, storageKey: true, deletedAt: true },
        orderBy: { id: 'asc' },
        take: PAGE,
      });
      if (page.length === 0) break;
      cursor = page[page.length - 1].id;

      const removable: string[] = [];
      for (const run of page) {
        if (run.storageKey && !run.deletedAt) {
          try {
            await storage.delete(run.storageKey);
            archivesDeleted += 1;
          } catch (error) {
            archivesFailed += 1;
            logger.warn(`backup run ${run.id}: archive could not be deleted: ${(error as Error)?.message}`);
            continue;
          }
        }
        removable.push(run.id);
      }
      if (removable.length > 0) {
        runsDeleted += (await system.backupRun.deleteMany({ where: { id: { in: removable } } })).count as number;
      }
    }

    return { backupArchivesDeleted: archivesDeleted, backupArchivesFailed: archivesFailed, backupRunsDeleted: runsDeleted };
  },
};

/** The custom secret types; the system types the seed provides stay. */
export const VAULT_SECRET_TYPES_STEP: FactoryResetStepDef = {
  id: 'vault.secret-types',
  phase: 'deployment',
  description: 'Every custom secret type (the system types stay).',
  summary: 'Every custom secret type',
  async run(tx: any): Promise<Record<string, number>> {
    const { count } = await tx.secretType.deleteMany({ where: { isSystem: false } });
    return { customSecretTypes: count as number };
  },
};

/** The steps, in registration order. */
export const VAULT_FACTORY_RESET_STEPS: readonly FactoryResetStepDef[] = [VAULT_BACKUPS_STEP, VAULT_SECRET_TYPES_STEP];

/** Registers {@link VAULT_FACTORY_RESET_STEPS}. Idempotent per process. */
export function registerVaultFactoryResetSteps(): void {
  for (const step of VAULT_FACTORY_RESET_STEPS) registerFactoryResetStep(step);
}
