import { Module } from '@nestjs/common';

import { CommonModule } from '../common/common.module';
import { StorageProvidersModule } from '../storage/providers';
import { SecretsModule } from '../secrets/secrets.module';
import { SettingsModule } from '../settings/settings.module';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';
import { BackupRunnerService } from './backup-runner.service';

@Module({
  // StorageProvidersModule for the raw STORAGE_PROVIDER token; SecretsModule
  // for SecretsExportService, whose per-user part writes each user folder;
  // SettingsModule for the redacted system settings of the system/ section.
  imports: [CommonModule, StorageProvidersModule, SecretsModule, SettingsModule],
  controllers: [BackupsController],
  providers: [BackupsService, BackupRunnerService],
})
export class BackupsModule {}
