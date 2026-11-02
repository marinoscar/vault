import { CryptoService } from '../common/services/crypto.service';

/**
 * Storage format of `backup_schedules.password_encrypted`: the JSON of
 * `CryptoService.encrypt()`'s output (`{ ciphertext, iv, authTag }`, base64),
 * the same AES-256-GCM envelope as every other encrypted value in the vault.
 *
 * Neither the plaintext nor this ciphertext may ever leave the API, be
 * logged, be put on a span or go into audit meta.
 */
interface StoredPassword {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function encryptBackupPassword(crypto: CryptoService, password: string): string {
  const { ciphertext, iv, authTag } = crypto.encrypt(password);
  const stored: StoredPassword = { ciphertext, iv, authTag };
  return JSON.stringify(stored);
}

/**
 * @throws Error (with a static message) when the value is malformed or cannot
 * be decrypted (missing or rotated VAULT_ENCRYPTION_KEY).
 */
export function decryptBackupPassword(crypto: CryptoService, stored: string): string {
  let parsed: Partial<StoredPassword>;
  try {
    parsed = JSON.parse(stored) as Partial<StoredPassword>;
  } catch {
    throw new Error('Stored backup password is malformed');
  }
  if (
    typeof parsed?.ciphertext !== 'string' ||
    typeof parsed.iv !== 'string' ||
    typeof parsed.authTag !== 'string'
  ) {
    throw new Error('Stored backup password is malformed');
  }
  try {
    return crypto.decrypt(parsed.ciphertext, parsed.iv, parsed.authTag);
  } catch {
    throw new Error('Stored backup password could not be decrypted');
  }
}
