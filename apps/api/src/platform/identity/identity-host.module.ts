// =============================================================================
// Identity's host ports, bound to Vault's services (issue #77, E3.2)
// =============================================================================
//
// The identity slice reaches the app through ports. This module binds them. It
// must be `@Global()`: the slice's `JwtAuthGuard` is instantiated in EVERY
// module whose controllers use `@Auth()`, so the ports it injects have to
// resolve there.
//
//   IDENTITY_NOTIFIER         -> logging adapter           (E7 binds the notifications slice)
//   IDENTITY_JOBS             -> JobsService + registry    (the platform's, E5.1)
//   USER_DEFAULTS             -> DEFAULT_USER_SETTINGS     (moves with the settings slice, E4.1)
//   IDENTITY_PROFILE_IMAGES   -> Vault's profile settings  (the storage slice replaces it, E6)
//   IDENTITY_NODE_CREDENTIALS -> NodeCredentialService     (the platform's, mounted below)
//   IDENTITY_EVENT_BUS        -> EVENT_BUS                 (host core)
//   IDENTITY_METRICS          -> AppMetricsService         (host core)
//
// `IDENTITY_AUTH_CREDENTIALS` stays unbound: Google reads the environment
// until the credentials slice (E4.2) lands.
//
// Keep the adapters THIN: later epics only change the `useClass` / `useExisting`
// targets below.
// =============================================================================

import { Global, Module } from '@nestjs/common';
import { AppMetricsService, EVENT_BUS } from '@marinoscar/platform-api/host';
import {
  IDENTITY_EVENT_BUS,
  IDENTITY_JOBS,
  IDENTITY_METRICS,
  IDENTITY_NODE_CREDENTIALS,
  IDENTITY_NOTIFIER,
  IDENTITY_PROFILE_IMAGES,
  USER_DEFAULTS,
} from '@marinoscar/platform-api/identity';
import { NodeCredentialModule, NodeCredentialService } from '@marinoscar/platform-api/nodes';

import { IdentityJobsAdapter } from './identity-jobs.adapter';
import { LoggingIdentityNotifier } from './identity-notifier.adapter';
import { VaultProfileImages, VaultUserDefaults } from './identity-user.adapters';

@Global()
@Module({
  // `NodeCredentialModule` is @Global and exports `NodeCredentialService`; it also
  // serves `/api/node-credentials` (admin, `nodes:read|write`). Mounted here
  // because the guard resolves `nod_` tokens through it. `NodesModule.forRoot`
  // (`platform/jobs/jobs.config.ts`, E5.1) mounts the rest of the nodes slice.
  imports: [NodeCredentialModule],
  providers: [
    { provide: IDENTITY_NOTIFIER, useClass: LoggingIdentityNotifier },
    { provide: IDENTITY_JOBS, useClass: IdentityJobsAdapter },
    { provide: USER_DEFAULTS, useClass: VaultUserDefaults },
    { provide: IDENTITY_PROFILE_IMAGES, useClass: VaultProfileImages },
    { provide: IDENTITY_NODE_CREDENTIALS, useExisting: NodeCredentialService },
    { provide: IDENTITY_EVENT_BUS, useExisting: EVENT_BUS },
    { provide: IDENTITY_METRICS, useExisting: AppMetricsService },
  ],
  exports: [
    IDENTITY_NOTIFIER,
    IDENTITY_JOBS,
    USER_DEFAULTS,
    IDENTITY_PROFILE_IMAGES,
    IDENTITY_NODE_CREDENTIALS,
    IDENTITY_EVENT_BUS,
    IDENTITY_METRICS,
  ],
})
export class IdentityHostModule {}
