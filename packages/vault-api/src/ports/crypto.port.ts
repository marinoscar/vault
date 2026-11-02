/**
 * VAULT_CRYPTO: the secret-value cipher (AES-256-GCM under `VAULT_ENCRYPTION_KEY`).
 *
 * The host owns the key and the algorithm; a slice only encrypts and decrypts through this port. A
 * secret value exists only as ciphertext (`secret_versions`), the archive password of a queued
 * backup only as ciphertext in the job payload. Never log, return or persist what `decrypt` gives.
 * The key is never re-encrypted or rotated without a rehearsed migration on a restored copy.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const VAULT_CRYPTO = Symbol.for('@marinoscar/vault/VAULT_CRYPTO');

/** The three base64 parts of one AES-256-GCM encryption. */
export interface VaultEncryptedData {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/**
 * The cipher port.
 *
 * @extensionPoint token
 * @stability experimental
 */
export interface VaultCryptoPort {
  /** Encrypts a UTF-8 string with a fresh random IV. */
  encrypt(plaintext: string): VaultEncryptedData;
  /** Decrypts what {@link encrypt} produced; throws when the tag does not verify. */
  decrypt(ciphertext: string, iv: string, authTag: string): string;
}
