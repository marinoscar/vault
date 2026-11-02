import { Injectable } from '@nestjs/common';
import type { Logger } from '@nestjs/common';
import type { IdentityJobHandler, IdentityJobsPort } from '@marinoscar/platform-api/identity';
import { enqueueHousekeepingJob, JobHandlerRegistry, JobsService } from '@marinoscar/platform-api/jobs';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Identity's `IDENTITY_JOBS` over the platform job queue (`JobsService` and
 * `JobHandlerRegistry` from `@marinoscar/platform-api/jobs`, E5.1). Replaces the
 * E3.2 no-op shim.
 *
 * The identity cleanup types are server-only (they delete credential rows, a
 * privilege a worker node must never hold): their handlers declare no
 * `nodeResultSchema` / `persistNodeResult`. The crons that enqueue them live in
 * the platform and only enqueue (`enqueueHousekeepingJob` skips a tick while one
 * is pending or running).
 */
@Injectable()
export class IdentityJobsAdapter implements IdentityJobsPort {
  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly jobs: JobsService,
    private readonly prisma: PrismaService,
  ) {}

  async enqueueHousekeepingJob(options: { type: string; what: string; logger: Logger }): Promise<void> {
    await enqueueHousekeepingJob({
      jobs: this.jobs,
      prisma: this.prisma,
      logger: options.logger,
      type: options.type,
      what: options.what,
    });
  }

  registerHandler(handler: IdentityJobHandler): void {
    this.registry.register(handler);
  }
}
