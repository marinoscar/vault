import { Injectable } from '@nestjs/common';
import { JobHandlerRegistry, JobsService } from '@marinoscar/platform-api/jobs';
import type { VaultJobsPort } from '@marinoscar/vault-api/ports';

/**
 * The package's `VAULT_JOBS` over the platform job queue: `JobsService` enqueues, the global
 * `JobHandlerRegistry` takes the handlers the package registers in `onModuleInit`.
 */
@Injectable()
export class VaultJobsAdapter implements VaultJobsPort {
  constructor(
    private readonly jobs: JobsService,
    private readonly registry: JobHandlerRegistry,
  ) {}

  enqueue: VaultJobsPort['enqueue'] = (input) => this.jobs.enqueue(input);

  enqueueWithin: VaultJobsPort['enqueueWithin'] = (tx, input) => this.jobs.enqueueWithin(tx, input);

  registerHandler: VaultJobsPort['registerHandler'] = (handler) => this.registry.register(handler);
}
