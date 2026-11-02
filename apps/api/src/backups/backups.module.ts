import { Module } from '@nestjs/common';

import { CommonModule } from '../common/common.module';
import { StorageProvidersModule } from '../storage/providers';
import { SecretsModule } from '../secrets/secrets.module';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';
import { BackupRunnerService } from './backup-runner.service';

@Module({
  // StorageProvidersModule for the raw STORAGE_PROVIDER token; SecretsModule
  // for SecretsExportService, whose per-user part writes each user folder.
  imports: [CommonModule, StorageProvidersModule, SecretsModule],
  controllers: [BackupsController],
  providers: [BackupsService, BackupRunnerService],
})
export class BackupsModule {}
