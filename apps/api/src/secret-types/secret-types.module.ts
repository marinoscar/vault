import { Module } from '@nestjs/common';
import { SecretTypesController } from './secret-types.controller';
import { SecretTypesService } from './secret-types.service';

@Module({
  controllers: [SecretTypesController],
  providers: [SecretTypesService],
  exports: [SecretTypesService],
})
export class SecretTypesModule {}
