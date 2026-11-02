// =============================================================================
// The platform AI conformance suites, run against Vault (issue #87, E8.1, epic #63)
// =============================================================================
//
// Five suites drive the real router over the AI runtime harness
// (`./ai-conformance/ai-fixture.ts`):
//
//   ai-kill-switch      with `ai.enabled = false` every `/api/ai/*` route except the probe
//                       answers 403 `AI_DISABLED`, `/api/admin/ai/*` stays reachable, and every
//                       `ai.*` job makes zero provider calls.
//   ai-rbac-matrix      every AI route x every role is granted or denied exactly as the seeded
//                       permission set says; a personal access token inherits its owner's grants.
//   ai-secret-egress    no key appears in a response, header, log line, audit row, usage row or
//                       run row.
//   ai-key-policy       `byok` never spends the deployment key; `byok_with_org_fallback` does so
//                       only for a caller with no key of their own.
//   ai-jobs-server-only no `ai.*` job type is node-eligible: no vendor offers a job-scoped sub-key.
//
// The two source scans (`ai-no-sdk-leak`, `ai-orchestration-boundary`) need no app and run in
// `conformance.spec.ts` beside the other scans. Nothing is skipped.
// =============================================================================

import '../src/app-registrations/registrations';

import '@marinoscar/platform-api/ai/testing';
import { runPlatformConformance } from '@marinoscar/platform-api/testing';

import { API_SOURCE_ROOT } from './jobs/cron-source-roots';
import { aiConformanceFixture } from './ai-conformance/ai-fixture';

runPlatformConformance({
  sourceRoots: [API_SOURCE_ROOT],
  suites: {
    aiKillSwitch: { fixture: aiConformanceFixture, minAiRoutes: 10, minAdminAiRoutes: 5, minAiJobTypes: 3 },
    aiRbacMatrix: { fixture: aiConformanceFixture, minRoutes: 15, minPermissionedRoutes: 10 },
    aiSecretEgress: { fixture: aiConformanceFixture },
    aiKeyPolicy: { fixture: aiConformanceFixture },
    aiJobsServerOnly: { fixture: aiConformanceFixture, minAiJobTypes: 3 },
  },
});
