import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

interface EncryptedData {
  ciphertext: string; // base64
  iv: string;         // base64
  authTag: string;    // base64
}

@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly logger = new Logger(CryptoService.name);
  private encryptionKey: Buffer;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const keyHex = this.config.get<string>('vault.encryptionKey');
    if (!keyHex) {
      this.logger.warn('VAULT_ENCRYPTION_KEY is not set - encryption features will not work');
      return;
    }
    this.encryptionKey = Buffer.from(keyHex, 'hex');
    if (this.encryptionKey.length !== 32) {
      throw new Error('VAULT_ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters)');
    }
    this.logger.log('Encryption key loaded successfully');
  }

  encrypt(plaintext: string): EncryptedData {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not configured');
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertext: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
    };
  }

  decrypt(ciphertext: string, iv: string, authTag: string): string {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not configured');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }
}
