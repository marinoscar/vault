// =============================================================================
// The jobs and nodes slices' host ports (issue #81, E5.1, epic #54)
// =============================================================================
//
//   JOBS_EVENT_BUS     -> EVENT_BUS            (the host core's cross-replica bus)
//   JOBS_METRICS       -> AppMetricsService    (the host core's instruments)
//   JOBS_ORG_SCOPE     -> no ambient org       (an omitted `orgId` becomes null)
//   NODE_JOB_INPUTS    -> node-job-inputs.adapter.ts   (no node-eligible type yet)
//   NODE_OBJECT_STORE  -> the storage slice's `nodeObjectStoreBinding` (E6.1): signs through STORAGE_PROVIDER
//
// `@Global()` so the slices' services resolve the ports from whichever module
// instantiates them.
//
// `JOBS_ORG_SCOPE` answers null: Vault has no ambient organization, and every
// enqueue passes `orgId` explicitly (an explicit null is never replaced). The
// job handlers that touch `org` tables (E5.2: none; the storage slice's) carry the org
// in their payload.
// =============================================================================

import { Global, Module } from '@nestjs/common';
import { AppMetricsService, EVENT_BUS } from '@marinoscar/platform-api/host';
import { JOBS_EVENT_BUS, JOBS_METRICS, JOBS_ORG_SCOPE } from '@marinoscar/platform-api/jobs';
import type { JobsOrgScope } from '@marinoscar/platform-api/jobs';
import { NODE_JOB_INPUTS, NODE_OBJECT_STORE } from '@marinoscar/platform-api/nodes';

import { StorageProvidersModule, nodeObjectStoreBinding } from '@marinoscar/platform-api/storage';
import { NodeJobInputsAdapter } from './node-job-inputs.adapter';

const NO_AMBIENT_ORG: JobsOrgScope = { currentOrgId: () => null };

@Global()
@Module({
  imports: [StorageProvidersModule],
  providers: [
    { provide: JOBS_EVENT_BUS, useExisting: EVENT_BUS },
    { provide: JOBS_METRICS, useExisting: AppMetricsService },
    { provide: JOBS_ORG_SCOPE, useValue: NO_AMBIENT_ORG },
    { provide: NODE_JOB_INPUTS, useClass: NodeJobInputsAdapter },
    nodeObjectStoreBinding,
  ],
  exports: [JOBS_EVENT_BUS, JOBS_METRICS, JOBS_ORG_SCOPE, NODE_JOB_INPUTS, NODE_OBJECT_STORE],
})
export class JobsHostModule {}
