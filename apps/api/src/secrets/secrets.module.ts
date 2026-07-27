import { Module } from '@nestjs/common';
import { SecretsController } from './secrets.controller';
import { SecretsService } from './secrets.service';
import { CommonModule } from '../common/common.module';
import { StorageProvidersModule } from '../storage/providers';

@Module({
  // StorageProvidersModule (not StorageModule): the service needs the raw
  // STORAGE_PROVIDER token to delete an orphaned blob. Importing StorageModule
  // would pull in ObjectsController/ObjectsService — a heavier dependency whose
  // delete() applies an uploader-ownership check this path must not inherit.
  imports: [CommonModule, StorageProvidersModule],
  controllers: [SecretsController],
  providers: [SecretsService],
  exports: [SecretsService],
})
export class SecretsModule {}
