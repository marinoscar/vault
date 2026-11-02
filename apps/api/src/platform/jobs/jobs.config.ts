// =============================================================================
// The jobs and nodes slices' composition (issue #81, E5.1, epic #54)
// =============================================================================
//
// `JobsModule.forRoot` is GLOBAL: the enqueue and claim services, the terminal
// state machine, the in-process worker pool, the lease reaper, the job-history
// purge, the temp-file janitor, the provider throttle and `/api/admin/jobs/*`.
// `NodesModule.forRoot` is the worker-node control plane: `/api/nodes/*`,
// `/api/admin/nodes/*`, the fleet sweep and prune and the brokered-secret sweep.
// `NodeCredentialModule` (mounted by `platform/identity/identity-host.module.ts`
// since E3.2) serves `/api/node-credentials`.
//
// ORDER: both `forRoot` calls ensure the `jobs`, `retention` and `nodes`
// system-settings namespaces, and the platform refuses a namespace registered
// after `SettingsModule.forRoot()` composed the request bodies. So `app.module.ts`
// imports this file BEFORE `platform/settings/settings.config.ts`.
//
// Vault registers no node-eligible job type, so a worker node can register and
// heartbeat but is never offered a job (see `docs/platform-adoption/`).
// =============================================================================

import { APP_NAME } from '@app/shared';
import { JobsModule } from '@marinoscar/platform-api/jobs';
import { NodesModule } from '@marinoscar/platform-api/nodes';

import '../../app-registrations/jobs';
import { JobsHostModule } from './jobs-host.module';

export const jobsModule = JobsModule.forRoot({
  appName: APP_NAME,
  imports: [JobsHostModule],
});

export const nodesModule = NodesModule.forRoot({ imports: [JobsHostModule] });
