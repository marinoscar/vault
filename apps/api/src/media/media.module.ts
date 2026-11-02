import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { CommonModule } from '../common/common.module';
import { storageModule } from '../platform/storage/storage.config';

@Module({
  imports: [CommonModule, storageModule],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
