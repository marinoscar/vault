import type { EnqueueJobInput, Job, JobHandler, JobsTx } from '@marinoscar/platform-api/jobs';

/**
 * VAULT_JOBS: the background job queue.
 *
 * Every long-running activity is a registered handler enqueued here (queue rule 1). Job `type`
 * strings are permanent once jobs of that type exist. Every enqueue passes `orgId` explicitly
 * (`null` for housekeeping and system jobs).
 *
 * @extensionPoint token
 * @stability experimental
 */
export const VAULT_JOBS = Symbol.for('@marinoscar/vault/VAULT_JOBS');

/**
 * The queue port: enqueue, enqueue inside the caller's transaction, and handler registration.
 *
 * @extensionPoint token
 * @stability experimental
 */
export interface VaultJobsPort {
  /** Queues a job. */
  enqueue(input: EnqueueJobInput): Promise<Job>;
  /** Queues a job inside the caller's transaction. */
  enqueueWithin(tx: JobsTx, input: EnqueueJobInput): Promise<Job>;
  /** Registers a handler for its `type`; called from `onModuleInit`. */
  registerHandler(handler: JobHandler): void;
}
