import { Module } from '@nestjs/common';
import { AdminBootstrapService } from './services/admin-bootstrap.service';
import { CryptoService } from './services/crypto.service';

@Module({
  providers: [AdminBootstrapService, CryptoService],
  exports: [AdminBootstrapService, CryptoService],
})
export class CommonModule {}
