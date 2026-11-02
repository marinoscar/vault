// =============================================================================
// The platform Doctor (issue #76)
// =============================================================================
//
// `GET /api/admin/doctor` (`system_settings:read`) runs every registered
// read-only health check and reports pass / warn / fail / skip with a remedy;
// `GET /api/admin/doctor/support-bundle` downloads a redacted diagnostic archive.
//
// Vault's own checks are in `./checks/` and provided by `DoctorChecksModule`.
// The platform's (`db.connection`, `db.migrations`, `db.rls_role`,
// `maintenance.mode`, ...) come with `PlatformHostCoreModule`.
// =============================================================================

import { DoctorModule } from '@marinoscar/platform-api/doctor';

import { platformHost } from '../platform/platform-host';

export const doctorModule = DoctorModule.forRoot({
  host: platformHost,
  supportBundle: { appSlug: 'vault' },
});
