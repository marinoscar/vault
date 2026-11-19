import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { enqueueHousekeepingJob } from '@marinoscar/platform-api/jobs';

import { DOCUMENT_EXPIRY_SCAN_JOB_TYPE } from './document-expiry-job-types';
import { VAULT_JOBS, VAULT_PRISMA, type VaultJobsPort, type VaultPrismaClient } from '../ports';

/**
 * The daily tick of the identity-document expiry reminders (IDOC-9). ENQUEUE-ONLY (queue rule 1):
 * it queues one `vault.documents.expiry_scan` housekeeping job (system job, `orgId` null); the scan
 * is the handler's. An already queued or running scan collapses a second enqueue.
 */
@Injectable()
export class DocumentExpiryTask {
  private readonly logger = new Logger(DocumentExpiryTask.name);

  constructor(
    @Inject(VAULT_JOBS) private readonly jobs: VaultJobsPort,
    @Inject(VAULT_PRISMA) private readonly prisma: VaultPrismaClient,
  ) {}

  /** 05:43 UTC daily, six minutes after the card scan. */
  @Cron('43 5 * * *')
  async handleTick(): Promise<void> {
    await enqueueHousekeepingJob({
      // The helper only calls `enqueue`, which the port carries; its type names the whole service.
      jobs: this.jobs as never,
      prisma: this.prisma as never,
      logger: this.logger,
      type: DOCUMENT_EXPIRY_SCAN_JOB_TYPE,
      what: 'document expiry scan',
    });
  }
}
