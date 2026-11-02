import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { decryptSecret, encryptSecret } from '@marinoscar/platform-api/core';

import { CryptoService } from '../../src/common/services/crypto.service';

// Two keys, two stores, on purpose (issue #80, docs/SECRETS.md):
//   VAULT_ENCRYPTION_KEY   -> secret versions, backups, the scheduled-backup password
//   SECRETS_ENCRYPTION_KEY -> the platform credential store (the AI key, the object store access key)
// Adopting the credentials slice must not move a secret value to the platform
// cipher: that would need a rehearsed re-encryption, not a refactor.

const SRC = join(__dirname, '..', '..', 'src');
// The domain slices live in the package since E12.2 (#103); the rule follows them.
const VAULT_API_SRC = join(__dirname, '..', '..', '..', '..', 'packages', 'vault-api', 'src');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (full.endsWith('.ts') && !full.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

describe('secret values stay under VAULT_ENCRYPTION_KEY', () => {
  const vault = new CryptoService({
    get: () => '00'.repeat(16) + '11'.repeat(16),
  } as never);
  vault.onModuleInit();

  it('a value encrypted by CryptoService is not readable with the platform cipher, and vice versa', () => {
    const enc = vault.encrypt('a secret value');
    const asPlatform = `${enc.iv}${enc.authTag}${enc.ciphertext}`;
    expect(() => decryptSecret(asPlatform, 'ai')).toThrow();

    const platformCiphertext = encryptSecret('a credential', 'ai');
    expect(() =>
      vault.decrypt(platformCiphertext, platformCiphertext, platformCiphertext),
    ).toThrow();
  });

  it.each(['secrets', 'backups', 'media', 'secret-types', 'card-expiry'])(
    'packages/vault-api/src/%s never touches the platform cipher or credential store',
    (folder) => {
      const offenders = sourceFiles(join(VAULT_API_SRC, folder)).filter((file) =>
        /platform-api\/credentials|encryptSecret|decryptSecret|SECRETS_ENCRYPTION_KEY|CredentialsService/.test(
          readFileSync(file, 'utf8'),
        ),
      );
      expect(offenders.map((f) => relative(VAULT_API_SRC, f))).toEqual([]);
    },
  );

  it('the secret-version writers encrypt through the VAULT_CRYPTO port (CryptoService)', () => {
    const service = readFileSync(join(VAULT_API_SRC, 'secrets', 'secrets.service.ts'), 'utf8');
    expect(service).toMatch(/VAULT_CRYPTO/);
    expect(service).toMatch(/crypto\.encrypt\(/);
  });

  it('the VAULT_CRYPTO port is bound to CryptoService, never to the platform cipher', () => {
    const config = readFileSync(join(SRC, 'platform', 'vault-api', 'vault-api.config.ts'), 'utf8');
    expect(config).toMatch(/crypto: \{ useExisting: CryptoService \}/);
  });

  // E9.2 (#90): the telemetry slice keeps its two GreptimeDB passwords in the credential store
  // (purpose `telemetry_greptime`); `telemetry-credentials.adapter.ts` is the one pass-through. It
  // never touches a secret value, a backup password or `VAULT_ENCRYPTION_KEY`.
  it('only the AI key presence reader, the legacy key migration, the storage key import and the telemetry adapter read the credential store in application code', () => {
    const readers = sourceFiles(SRC)
      .filter((file) => /import(?:\s+type)?\s*\{[^}]*\bCredentialsService\b[^}]*\}\s*from/.test(readFileSync(file, 'utf8')))
      .map((f) => relative(SRC, f))
      .sort();
    expect(readers).toEqual([
      'ai/ai-key-migration.ts',
      'platform/credentials/ai-key-presence.service.ts',
      // E6.1: the one-time import of the object store's access key (purpose `storage`).
      'platform/storage/storage-env-import.service.ts',
      'platform/storage/storage-env-import.ts',
      'platform/telemetry/telemetry-credentials.adapter.ts',
    ]);
  });
});
