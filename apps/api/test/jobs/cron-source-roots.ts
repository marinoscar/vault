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
// their written reasons. Each would be a `PLATFORM-ADOPTION-SHIM` row in
// docs/platform-adoption/local-exceptions.md. Both lists are empty since E6.1.
// =============================================================================

import { join } from 'node:path';

/** The API's own source root. */
export const API_SOURCE_ROOT = join(__dirname, '..', '..', 'src');

/**
 * The Vault domain package's source root (E12.2, #103). The domain's crons, listeners and handlers
 * moved there, so the same scans run over it: the queue rule does not stop at the package border.
 */
export const VAULT_API_SOURCE_ROOT = join(__dirname, '..', '..', '..', '..', 'packages', 'vault-api', 'src');

/** Every root of Vault's own source the queue-rule scans walk. */
export const VAULT_SOURCE_ROOTS: readonly string[] = [API_SOURCE_ROOT, VAULT_API_SOURCE_ROOT];

/**
 * `@Cron` files allowed to work inline. EMPTY since E6.1: the storage cleanup
 * sweep that was the last one is now the platform's enqueue-only
 * `storage.cleanup.stale-uploads` cron. The three permanent exemptions are the
 * platform's own (lease reaper, temp-file janitor, node-secret sweep) and ship in
 * the package. An entry needs a reason of more than 40 characters.
 */
export const CRON_EXEMPTIONS: ReadonlyArray<{ readonly file: string; readonly why: string }> = [];

/**
 * `@OnEvent` files whose listener may move bytes. EMPTY since E6.1: the upload
 * listener that downloaded the object inline is now the platform's
 * `storage.object.process` job, and Vault has no `@OnEvent` I/O left.
 */
export const LISTENER_EXEMPTIONS: ReadonlyArray<{ readonly file: string; readonly why: string }> = [];
