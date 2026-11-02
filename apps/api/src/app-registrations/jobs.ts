// =============================================================================
// Vault's job registrations (issue #81, E5.1, epic #54)
// =============================================================================
//
// What Vault adds to the platform's jobs and nodes registries:
//
//   * enqueue reasons beyond the built-ins (`upload`, `rerun`, `backfill`): none;
//   * retention policies for the nightly retention purge: none;
//   * node span attributes a worker node may relay: none;
//   * labels for the job types whose handler declares none. The two identity
//     housekeeping types label themselves; E5.2 adds `vault.backup.run` and
//     `vault.user_backup.run`, which declare their own `label`.
//
// A job `type` string is PERMANENT once a row of that type exists
// (`test/jobs/job-type-snapshot.spec.ts` pins them).
//
// IMPORTED BY `platform/jobs/jobs.config.ts` and `registrations.ts`, so it runs
// before the application is created (the registries freeze when it bootstraps).
// =============================================================================

import {
  registerJobReason,
  registerRetentionPolicy,
  type JobReasonDefinition,
  type RetentionPolicyDefinition,
} from '@marinoscar/platform-api/jobs';
import {
  registerNodeSpanAttribute,
  type NodeSpanAttributeDefinition,
} from '@marinoscar/platform-api/nodes';

/** Extra enqueue reasons. Empty: the built-ins are enough. */
export const APP_JOB_REASONS: readonly JobReasonDefinition[] = [];

/** Retention policies Vault adds to the platform's. */
export const APP_RETENTION_POLICIES: readonly RetentionPolicyDefinition[] = [];

/** Span attributes a worker node may relay beyond the platform's built-ins. */
export const APP_NODE_SPAN_ATTRIBUTES: readonly NodeSpanAttributeDefinition[] = [];

let registered = false;

if (!registered) {
  registered = true;
  APP_JOB_REASONS.forEach(registerJobReason);
  APP_RETENTION_POLICIES.forEach(registerRetentionPolicy);
  APP_NODE_SPAN_ATTRIBUTES.forEach(registerNodeSpanAttribute);
}
