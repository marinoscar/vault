import { Module } from '@nestjs/common';
import { StorageProvidersModule } from '@marinoscar/platform-api/storage';

import { CredentialsModule } from '../credentials/credentials.config';
import { StorageEnvImportService } from './storage-env-import.service';

/** Runs the one-time import of the legacy storage environment at boot (E6.1). */
@Module({ imports: [CredentialsModule, StorageProvidersModule], providers: [StorageEnvImportService] })
export class StorageEnvImportModule {}
