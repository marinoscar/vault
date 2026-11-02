// =============================================================================
// The exports slice's host ports (issue #91, E9.3, epic #64)
// =============================================================================
//
//   EXPORTS_SYSTEM_DATA -> PrismaSystemService          (the bypass client, `asSystem(reason)`)
//   EXPORTS_NOTIFIER    -> exports-notifier.adapter.ts   (`NotificationsService`)
//
// `EXPORTS_SYSTEM_DATA` is the SEPARATE client on its own pool that the platform's
// `app.rls_bypass` flag rides on. The slice reads a user's rows across organizations through it
// (reason `export`) and the expiry deletes through it (`purge`); every query the slice and the
// `vault-secrets` source send names its owner explicitly, so lifting row-level security widens
// nothing. NOT @Global: `ExportsModule.forRoot({ imports: [ExportsHostModule] })` is the only
// consumer, which keeps the bypass client's reach narrow.
// =============================================================================

import { Module } from '@nestjs/common';
import { EXPORTS_NOTIFIER, EXPORTS_SYSTEM_DATA } from '@marinoscar/platform-api/exports';
import type { ExportsSystemData } from '@marinoscar/platform-api/exports';

import { PrismaSystemService } from '../../prisma/prisma-system.service';
import { ExportsNotifierAdapter } from './exports-notifier.adapter';

@Module({
  providers: [
    {
      provide: EXPORTS_SYSTEM_DATA,
      inject: [PrismaSystemService],
      useFactory: (system: PrismaSystemService): ExportsSystemData => ({
        asSystem: (reason) => system.forSystem(reason) as never,
      }),
    },
    { provide: EXPORTS_NOTIFIER, useClass: ExportsNotifierAdapter },
  ],
  exports: [EXPORTS_SYSTEM_DATA, EXPORTS_NOTIFIER],
})
export class ExportsHostModule {}
