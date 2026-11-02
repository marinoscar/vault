import { Global, Module } from '@nestjs/common';
import { ONBOARDING_DATA } from '@marinoscar/platform-api/onboarding';

import { OnboardingDataAdapter } from './onboarding-data.adapter';

// =============================================================================
// The onboarding slice's host ports (issue #91, E9.3, epic #64)
// =============================================================================
//
//   ONBOARDING_DATA      -> OnboardingDataAdapter   (this app's Prisma client)
//   ONBOARDING_FEATURES  -> not bound. No registered step names a `feature`, and an unbound gate only
//                           omits feature-gated steps. The AI-dependent steps read their own fact
//                           (`vault.cardScan`), which asks the AI config the same question
//                           `GET /api/ai/status` does.
//
// `@Global()` so the slice's services resolve the port from whichever module instantiates them.
// =============================================================================

@Global()
@Module({
  providers: [OnboardingDataAdapter, { provide: ONBOARDING_DATA, useExisting: OnboardingDataAdapter }],
  exports: [ONBOARDING_DATA],
})
export class OnboardingHostModule {}
