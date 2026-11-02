// =============================================================================
// The platform host module (issue #76, epic #54)
// =============================================================================
//
// Binds the DI-time host ports every packaged slice reaches the app through:
//
//   AUDIT_SINK             -> `audit_events` (PrismaAuditSink)
//   SYSTEM_SETTINGS_STORE  -> the system-settings shim (E4.1 replaces it)
//   PLATFORM_PRISMA        -> the existing PrismaService
//
// `PlatformHostModule.forRoot` is GLOBAL. The host CORE module (event bus,
// maintenance, the response envelope) is mounted by `host-core.config.ts`.
// =============================================================================

import { PlatformHostModule } from '@marinoscar/platform-api/core';

import { PrismaService } from '../prisma/prisma.service';
import { PrismaAuditSink } from './audit-sink.adapter';
import { SystemSettingsShim } from './system-settings.shim';

export const platformHostModule = PlatformHostModule.forRoot({
  audit: { useClass: PrismaAuditSink },
  settings: { useExisting: SystemSettingsShim },
  prisma: { useExisting: PrismaService },
});
