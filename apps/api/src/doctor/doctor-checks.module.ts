// =============================================================================
// Vault's Doctor checks (issue #76, epic #54)
// =============================================================================
//
// Each check registers itself with the platform `DoctorCheckRegistry` in its own
// `onModuleInit`, so being in the module graph IS the registration. The checks
// are READ-ONLY: they select and describe, and never create, alter or write.
// =============================================================================

import { Module } from '@nestjs/common';

import { CommonModule } from '../common/common.module';
import { VaultBackupScheduleDoctorCheck } from './checks/vault-backup-schedule.doctor-check';
import { VaultEncryptionKeyDoctorCheck } from './checks/vault-encryption-key.doctor-check';
import { VaultStorageEnvDoctorCheck } from './checks/vault-storage-env.doctor-check';

@Module({
  imports: [CommonModule],
  providers: [VaultEncryptionKeyDoctorCheck, VaultBackupScheduleDoctorCheck, VaultStorageEnvDoctorCheck],
})
export class DoctorChecksModule {}
