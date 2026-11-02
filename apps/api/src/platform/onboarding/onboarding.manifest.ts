import { permissionRegistry } from '@marinoscar/platform-api/core';
import {
  PLATFORM_ONBOARDING_FACTS,
  PLATFORM_ONBOARDING_STEPS,
  registerOnboardingFact,
  registerOnboardingStep,
} from '@marinoscar/platform-api/onboarding';

import { VAULT_ONBOARDING_FACT_DEFS } from './onboarding.facts';
import { VAULT_ONBOARDING_STEP_DEFS } from './onboarding.steps';

// =============================================================================
// This app's onboarding manifest (issue #91, E9.3, epic #64)
// =============================================================================
//
// Registers the platform's facts and steps, then Vault's (`onboarding.steps.ts`). Registration order
// is not load-bearing: a step's `order` fixes the rendered sequence and the boot-time
// `assertOnboardingRegistries` checks that every fact a step names exists.
//
// A PLATFORM STEP IS REGISTERED ONLY WHEN THE PERMISSION IT NAMES EXISTS in this deployment's
// registry. The built-in `admin.backup` ("Schedule database backups") names `db_backup:read`, which
// only the db-backup slice declares; registering it without the slice would be a step nobody could
// act on and the `onboarding` conformance suite ("every step permission is a registered permission")
// would fail. When the slice is mounted its permission is registered and the step appears with no
// change here.
//
// CALLED BY `app-registrations/registrations.ts`, AFTER the permissions are registered (the filter
// reads them), because the stored `onboarding` user-settings namespace's merge reads the step
// registry: it must be filled in any process that can handle `PATCH /api/user-settings`, the
// OpenAPI dump and the specs included.
// =============================================================================

let registered = false;

/** Registers the onboarding facts and steps. Idempotent per process. Needs the permissions registered. */
export function registerVaultOnboarding(): void {
  if (registered) return;
  registered = true;

  registerOnboardingFact(...PLATFORM_ONBOARDING_FACTS, ...VAULT_ONBOARDING_FACT_DEFS);
  registerOnboardingStep(
    ...PLATFORM_ONBOARDING_STEPS.filter((step) => step.permission === undefined || permissionRegistry.has(step.permission)),
    ...VAULT_ONBOARDING_STEP_DEFS,
  );
}
