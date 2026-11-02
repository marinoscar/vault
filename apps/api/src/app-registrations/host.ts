// =============================================================================
// This app's host registrations (issue #76, epic #54)
// =============================================================================
//
// What Vault adds to the platform host slice through its registries. Today that
// is the error-code vocabulary; the two Doctor checks are providers, not
// registrations (`doctor/doctor-checks.module.ts`).
//
// IMPORTED BY `platform/host-core.config.ts`, so it runs before the application
// is created (the registries freeze when it bootstraps).
// =============================================================================

import './error-codes';
