import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type { VaultCryptoPort, VaultEncryptedData } from '../ports';

/**
 * A real AES-256-GCM cipher over a key the test chooses (64 hex characters), for specs and
 * conformance runs that need `VAULT_CRYPTO` to round-trip. The deployment's cipher is the host's.
 *
 * @stability experimental
 */
export class TestCrypto implements VaultCryptoPort {
  private readonly key: Buffer;

  constructor(keyHex: string = 'ab'.repeat(32)) {
    this.key = Buffer.from(keyHex, 'hex');
    if (this.key.length !== 32) throw new Error('TestCrypto needs a 32-byte key (64 hex characters)');
  }

  /** No-op, so a spec written for the host's cipher (`onModuleInit`) runs unchanged. */
  onModuleInit(): void {}

  encrypt(plaintext: string): VaultEncryptedData {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      ciphertext: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }

  decrypt(ciphertext: string, iv: string, authTag: string): string {
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
  }
}
