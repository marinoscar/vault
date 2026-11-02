import { OnboardingModule } from '@marinoscar/platform-api/onboarding';

import { OnboardingHostModule } from './onboarding-host.module';

// =============================================================================
// The onboarding slice's composition (issue #91, E9.3, epic #64)
// =============================================================================
//
//   GET /api/onboarding                the caller's stored UI state, the `user` checklist and, for a
//                                      holder of `system_settings:read`, the `admin` checklist
//                                      (`user_settings:read`, which every role holds)
//   GET /api/admin/onboarding/metrics  aggregate activation metrics (`system_settings:read`)
//
// There is no separate `GET /api/admin/onboarding`: the admin block rides on the one route. The
// steps and facts are registered by `registerVaultOnboarding()` (called from
// `app-registrations/registrations.ts`, every entry point's first import), so they exist before
// this module composes and in any process that handles `PATCH /api/user-settings`. Completion is
// derived on every read and never stored; only the caller's intent is, in the platform's
// `onboarding` user-settings namespace (`settings/registry/user-settings.manifest.ts`).
// =============================================================================

export const onboardingModule = OnboardingModule.forRoot({ imports: [OnboardingHostModule] });
