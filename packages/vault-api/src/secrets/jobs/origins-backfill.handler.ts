import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { enqueueHousekeepingJob, type Job, type JobHandler } from '@marinoscar/platform-api/jobs';
import { originsFromCredential } from '@marinoscar/vault-contract/secrets';

import {
  VAULT_AUDIT,
  VAULT_CRYPTO,
  VAULT_JOBS,
  VAULT_PRISMA,
  type VaultAuditPort,
  type VaultCryptoPort,
  type VaultJobsPort,
  type VaultPrismaClient,
} from '../../ports';
import {
  SECRETS_ORIGINS_BACKFILLED_AUDIT_ACTION,
  SECRETS_ORIGINS_BACKFILL_JOB_TYPE,
  SECRETS_ORIGINS_BACKFILL_PROFILE,
} from './origins-backfill-job-types';

const BATCH_SIZE = 200;

/** What a backfill did. Counts only. */
export interface OriginsBackfillResult {
  scanned: number;
  updated: number;
  unreadable: number;
}

/**
 * `vault.secrets.origins.backfill`: fills `secrets.origins` for every existing Credential from its
 * current version (system job, `orgId` null).
 *
 * SERVER-ONLY (no `nodeResultSchema` / `persistNodeResult`): it decrypts with `VAULT_ENCRYPTION_KEY`.
 *
 * Takes from a decrypted payload ONLY `url` and `additional_urls`, reduced to origins; the plaintext
 * is dropped in the same expression and never logged. Batched by keyset on the secret id (200 per
 * batch) and idempotent: it writes only when the computed origins differ from the stored ones, so a
 * re-run changes nothing. An unreadable version is counted and skipped (logged by id only); if EVERY
 * Credential is unreadable the job fails loudly (a rotated key).
 */
@Injectable()
export class OriginsBackfillHandler implements JobHandler, OnModuleInit {
  readonly type = SECRETS_ORIGINS_BACKFILL_JOB_TYPE;
  readonly label = 'Secret origins backfill';
  readonly profile = SECRETS_ORIGINS_BACKFILL_PROFILE;
  private readonly logger = new Logger(OriginsBackfillHandler.name);

  constructor(
    @Inject(VAULT_JOBS) private readonly jobs: VaultJobsPort,
    @Inject(VAULT_PRISMA) private readonly prisma: VaultPrismaClient,
    @Inject(VAULT_CRYPTO) private readonly crypto: VaultCryptoPort,
    @Inject(VAULT_AUDIT) private readonly auditLog: VaultAuditPort,
  ) {}

  onModuleInit(): void {
    this.jobs.registerHandler(this);
  }

  async process(_job: Job): Promise<void> {
    const result = await this.run();
    if (result.scanned > 0 && result.unreadable === result.scanned) {
      throw new Error('No Credential could be read; check the encryption key');
    }
    try {
      await this.auditLog.record({
        action: SECRETS_ORIGINS_BACKFILLED_AUDIT_ACTION,
        targetType: 'system',
        targetId: 'secrets.origins',
        meta: { ...result },
      });
    } catch (error) {
      this.logger.warn(`The backfill could not be recorded: ${(error as Error)?.message}`);
    }
  }

  /** One pass over every Credential. Public so the db test can run it directly. */
  async run(): Promise<OriginsBackfillResult> {
    const result: OriginsBackfillResult = { scanned: 0, updated: 0, unreadable: 0 };
    const type = await this.prisma.secretType.findFirst({
      where: { name: 'Credential', isSystem: true },
      select: { id: true },
    });
    if (!type) return result;

    let cursor: string | undefined;
    for (;;) {
      const secrets = await this.prisma.secret.findMany({
        where: { typeId: type.id },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: {
          id: true,
          origins: true,
          versions: {
            where: { isCurrent: true },
            take: 1,
            select: { encryptedData: true, iv: true, authTag: true },
          },
        },
      });
      if (secrets.length === 0) break;
      cursor = secrets[secrets.length - 1].id;

      for (const secret of secrets) {
        const version = secret.versions[0];
        if (!version) continue;
        result.scanned += 1;
        let origins: string[];
        try {
          origins = originsFromCredential(
            JSON.parse(this.crypto.decrypt(version.encryptedData, version.iv, version.authTag)),
          );
        } catch {
          result.unreadable += 1;
          this.logger.warn(`Credential ${secret.id}: the current version could not be read; skipped`);
          continue;
        }
        if (origins.length === secret.origins.length && origins.every((o, i) => o === secret.origins[i])) continue;
        await this.prisma.secret.update({ where: { id: secret.id }, data: { origins } });
        result.updated += 1;
      }
    }
    this.logger.log(
      `Origins backfill: ${result.scanned} credential(s) read, ${result.updated} updated, ${result.unreadable} unreadable`,
    );
    return result;
  }
}

/**
 * Queues the backfill once after the migration: on boot, when no completed backfill is recorded
 * (audit action `vault.secrets.origins_backfilled`) and at least one Credential exists. ENQUEUE-ONLY
 * (queue rule 1): the work is the handler's; the queue's active-dedup key collapses a second enqueue
 * from another instance. Once the first run finishes it records the audit row and boots stop queueing.
 */
@Injectable()
export class OriginsBackfillBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(OriginsBackfillBootstrap.name);

  constructor(
    @Inject(VAULT_JOBS) private readonly jobs: VaultJobsPort,
    @Inject(VAULT_PRISMA) private readonly prisma: VaultPrismaClient,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const done = await this.prisma.auditEvent.findFirst({
        where: { action: SECRETS_ORIGINS_BACKFILLED_AUDIT_ACTION },
        select: { id: true },
      });
      if (done) return;
      const credential = await this.prisma.secret.findFirst({
        where: { type: { name: 'Credential', isSystem: true } },
        select: { id: true },
      });
      if (!credential) return;
      await enqueueHousekeepingJob({
        jobs: this.jobs as never,
        prisma: this.prisma as never,
        logger: this.logger,
        type: SECRETS_ORIGINS_BACKFILL_JOB_TYPE,
        what: 'secret origins backfill',
      });
    } catch (error) {
      this.logger.warn(`Could not queue the origins backfill: ${(error as Error)?.message}`);
    }
  }
}
