// =============================================================================
// The user-data slice's host port (issue #91, E9.3, epic #64)
// =============================================================================
//
// `USER_DATA_DB` is the bypass client the purge deletes through: the per-user purge removes rows
// across organizations' RLS-governed tables (storage objects among them) and the Danger Zone
// summary counts them. It is the app's `PrismaSystemService`, the SEPARATE client on its own pool
// that the platform's `app.rls_bypass` flag rides on. The two reasons the slice uses (`purge`,
// `admin-aggregate`) are built into the platform's access-reason registry, and every statement
// carries an explicit owner filter, so lifting row-level security widens nothing.
//
// It also hands the factory reset's backup step (`factory-reset.steps.ts`) the ports a registered
// step function cannot inject, and provides the `vault.user_data.purge` delegate handler.
//
// Not @Global: only `UserDataModule.forRoot({ imports: [UserDataHostModule] })` needs it.
// =============================================================================

import { Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { runAsSystem } from '@marinoscar/platform-api/core';
import { STORAGE_PROVIDER, StorageProvidersModule, type StorageProvider } from '@marinoscar/platform-api/storage';
import { USER_DATA_DB } from '@marinoscar/platform-api/user-data';
import type { UserDataDbPort, UserDataSystemReason } from '@marinoscar/platform-api/user-data';

import { PrismaSystemService } from '../../prisma/prisma-system.service';
import { bindVaultFactoryResetDeps } from './factory-reset.steps';
import { withRequiredFieldFilters } from './required-field-filters';
import { VaultUserDataPurgeHandler } from './vault-user-data-purge.handler';

/** Binds the backup step's ports once the container is up. */
@Injectable()
export class VaultFactoryResetBinding implements OnModuleInit {
  constructor(
    @Inject(USER_DATA_DB) private readonly db: UserDataDbPort,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  onModuleInit(): void {
    bindVaultFactoryResetDeps({ db: this.db, storage: this.storage });
  }
}

@Module({
  imports: [StorageProvidersModule],
  providers: [
    VaultFactoryResetBinding,
    VaultUserDataPurgeHandler,
    {
      provide: USER_DATA_DB,
      inject: [PrismaSystemService],
      useFactory: (system: PrismaSystemService): UserDataDbPort => ({
        runAsSystem: <R>(
          reason: UserDataSystemReason,
          fn: (tx: unknown) => Promise<R>,
          options?: { timeout?: number },
        ): Promise<R> => runAsSystem(system as never, reason, fn as never, options) as Promise<R>,
        // PLATFORM-ADOPTION-SHIM(E9.3): see required-field-filters.ts (the factory reset summary).
        system: (reason: UserDataSystemReason) => withRequiredFieldFilters(system.forSystem(reason)),
      }),
    },
  ],
  exports: [USER_DATA_DB],
})
export class UserDataHostModule {}
