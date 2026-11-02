import { Module } from '@nestjs/common';

import { CommonModule } from '../common/common.module';
import { StorageProvidersModule } from '../storage/providers';
import { SecretsModule } from '../secrets/secrets.module';
import { AiModule } from '../ai/ai.module';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';
import { BackupArchiveService } from './backup-archive.service';
import { BackupQueueService } from './backup-queue.service';
import { BackupNotifier } from './backup-notifier.service';
import { BackupRunnerService } from './backup-runner.service';
import { BackupScheduleTask } from './backup-schedule.task';
import { BackupRunHandler } from './jobs/backup-run.handler';
import { UserBackupRunHandler } from './jobs/user-backup-run.handler';
import { MyBackupsController } from './my-backups.controller';
import { MyBackupsService } from './my-backups.service';

@Module({
  // StorageProvidersModule for the raw STORAGE_PROVIDER token; SecretsModule
  // for SecretsExportService, whose per-user part writes each user folder;
  // AiModule (AiConfigService) to report whether an AI key is stored (system/ section).
  // JobsService and JobHandlerRegistry come from the global JobsModule (E5.1); the two
  // handlers self-register in onModuleInit (E5.2).
  imports: [CommonModule, StorageProvidersModule, SecretsModule, AiModule],
  controllers: [BackupsController, MyBackupsController],
  providers: [
    BackupsService,
    MyBackupsService,
    BackupArchiveService,
    BackupQueueService,
    BackupNotifier,
    BackupRunnerService,
    BackupScheduleTask,
    BackupRunHandler,
    UserBackupRunHandler,
  ],
})
export class BackupsModule {}
