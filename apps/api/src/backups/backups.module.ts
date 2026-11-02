import { Module } from '@nestjs/common';

import { CommonModule } from '../common/common.module';
import { StorageProvidersModule } from '../storage/providers';
import { SecretsModule } from '../secrets/secrets.module';
import { AiModule } from '../ai/ai.module';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';
import { BackupRunnerService } from './backup-runner.service';
import { MyBackupsController } from './my-backups.controller';
import { MyBackupsService } from './my-backups.service';

@Module({
  // StorageProvidersModule for the raw STORAGE_PROVIDER token; SecretsModule
  // for SecretsExportService, whose per-user part writes each user folder;
  // AiModule (AiConfigService) to report whether an AI key is stored (system/ section).
  imports: [CommonModule, StorageProvidersModule, SecretsModule, AiModule],
  controllers: [BackupsController, MyBackupsController],
  providers: [BackupsService, BackupRunnerService, MyBackupsService],
})
export class BackupsModule {}
