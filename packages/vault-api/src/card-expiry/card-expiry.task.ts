import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { enqueueHousekeepingJob } from '@marinoscar/platform-api/jobs';


import { CARD_EXPIRY_SCAN_JOB_TYPE } from './card-expiry-job-types';
import { VAULT_JOBS, VAULT_PRISMA, type VaultJobsPort, type VaultPrismaClient } from '../ports';

/**
 * The daily tick of the card expiry reminders. ENQUEUE-ONLY (queue rule 1): it queues one
 * `vault.cards.expiry_scan` housekeeping job (system job, `orgId` null); the scan is the handler's.
 * An already queued or running scan collapses a second enqueue.
 */
@Injectable()
export class CardExpiryTask {
  private readonly logger = new Logger(CardExpiryTask.name);

  constructor(
    @Inject(VAULT_JOBS) private readonly jobs: VaultJobsPort,
    @Inject(VAULT_PRISMA) private readonly prisma: VaultPrismaClient,
  ) {}

  /** 05:37 UTC daily. */
  @Cron('37 5 * * *')
  async handleTick(): Promise<void> {
    await enqueueHousekeepingJob({
      // The helper only calls `enqueue`, which the port carries; its type names the whole service.
      jobs: this.jobs as never,
      prisma: this.prisma as never,
      logger: this.logger,
      type: CARD_EXPIRY_SCAN_JOB_TYPE,
      what: 'card expiry scan',
    });
  }
}
