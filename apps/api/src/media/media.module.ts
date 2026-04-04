import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { CommonModule } from '../common/common.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [CommonModule, StorageModule],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
