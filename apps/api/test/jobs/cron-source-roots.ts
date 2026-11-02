// =============================================================================
// Where the queue rule looks (issue #81 E5.1, #82 E5.2, #83 E5.3, epic #54)
// =============================================================================
//
// The `cron-enqueue-only` suite (a `@Cron` body only enqueues) and the
// `on-event-no-io` suite (an `@OnEvent` body moves no bytes) scan Vault's own
// sources. The platform's crons and listeners (the three permanent exemptions
// among them) ship compiled in `@marinoscar/platform-api` and are proven by the
// package's own tests, so they are not scanned here.
//
// Both suites are SHARED DATA, so the known exceptions live in this one file with
// their written reasons. Each is a `PLATFORM-ADOPTION-SHIM` row in
// docs/platform-adoption/local-exceptions.md, and each names the epic that deletes
// it (and with it, its entry here).
// =============================================================================

import { join } from 'node:path';

/** The API's own source root. */
export const API_SOURCE_ROOT = join(__dirname, '..', '..', 'src');

/**
 * `@Cron` files allowed to work inline. The suite requires each to hold a
 * `@Cron` and a reason of more than 40 characters, so an exemption cannot outlive
 * the code it excuses.
 */
export const CRON_EXEMPTIONS = [
  {
    file: 'storage/tasks/storage-cleanup.task.ts',
    why: 'PLATFORM-ADOPTION-SHIM(E6): the daily sweep of stale pending/uploading storage objects aborts multipart uploads and deletes rows inline, through the legacy storage provider. The storage slice (E6) brings the platform\'s own stale-upload cleanup job and deletes this task.',
  },
] as const;

/**
 * `@OnEvent` files whose listener may move bytes. The platform's `on-event-no-io`
 * suite has no per-file exemption (and would be vacuous here: this is the only
 * listener file Vault has left), so `on-event-no-io.spec.ts` applies the same
 * markers itself and honours this list.
 */
export const LISTENER_EXEMPTIONS = [
  {
    file: 'storage/processing/object-processing.service.ts',
    why: 'PLATFORM-ADOPTION-SHIM(E6): handleObjectUploaded downloads the uploaded object to run the processors, detached from the upload request. The storage slice (E6) replaces it with the platform\'s post-upload processor job and this file is deleted.',
  },
] as const;
