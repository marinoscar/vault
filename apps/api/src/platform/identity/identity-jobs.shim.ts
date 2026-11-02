import { Injectable, Logger } from '@nestjs/common';
import type { IdentityJobHandler, IdentityJobsPort } from '@marinoscar/platform-api/identity';

/**
 * PLATFORM-ADOPTION-SHIM(E5.1): identity's `IDENTITY_JOBS` port with no queue
 * behind it.
 *
 * The platform binds this port to `JobsService` and `JobHandlerRegistry`, but
 * `JobsModule` needs the settings slice (E4.1), which itself needs identity, so
 * the queue cannot be mounted in the same change. Until E5.1:
 *
 *   - the two handlers (`auth.token.cleanup`, `device-auth.code.cleanup`) are
 *     remembered, never run;
 *   - the two crons call `enqueueHousekeepingJob`, which only logs.
 *
 * The consequence is deliberate and recorded in
 * docs/platform-adoption/local-exceptions.md: expired and revoked refresh tokens
 * and device codes are not purged until E5.1 binds the queue (the legacy
 * `TokenCleanupTask` / `DeviceCodeCleanupTask` were deleted with the legacy
 * auth stack). They are inert rows; the guards already reject them.
 */
@Injectable()
export class IdentityJobsShim implements IdentityJobsPort {
  private readonly logger = new Logger(IdentityJobsShim.name);
  readonly handlers = new Map<string, IdentityJobHandler>();

  async enqueueHousekeepingJob(options: { type: string; what: string }): Promise<void> {
    this.logger.debug(`Skipping ${options.what}: the job queue is not mounted yet (${options.type})`);
  }

  registerHandler(handler: IdentityJobHandler): void {
    this.handlers.set(handler.type, handler);
  }
}
