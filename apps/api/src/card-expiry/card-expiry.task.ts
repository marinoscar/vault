import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { JobsService, enqueueHousekeepingJob } from '@marinoscar/platform-api/jobs';

import { PrismaService } from '../prisma/prisma.service';
import { CARD_EXPIRY_SCAN_JOB_TYPE } from './card-expiry-job-types';

/**
 * The daily tick of the card expiry reminders. ENQUEUE-ONLY (queue rule 1): it queues one
 * `vault.cards.expiry_scan` housekeeping job (system job, `orgId` null); the scan is the handler's.
 * An already queued or running scan collapses a second enqueue.
 */
@Injectable()
export class CardExpiryTask {
  private readonly logger = new Logger(CardExpiryTask.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly prisma: PrismaService,
  ) {}

  /** 05:37 UTC daily. */
  @Cron('37 5 * * *')
  async handleTick(): Promise<void> {
    await enqueueHousekeepingJob({
      jobs: this.jobs,
      prisma: this.prisma as never,
      logger: this.logger,
      type: CARD_EXPIRY_SCAN_JOB_TYPE,
      what: 'card expiry scan',
    });
  }
}
