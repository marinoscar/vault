import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { decryptSecret, encryptSecret } from '@marinoscar/platform-api/core';

import { CryptoService } from '../../src/common/services/crypto.service';

// Two keys, two stores, on purpose (issue #80, docs/SECRETS.md):
//   VAULT_ENCRYPTION_KEY   -> secret versions, backups, the scheduled-backup password
//   SECRETS_ENCRYPTION_KEY -> the platform credential store (the AI key)
// Adopting the credentials slice must not move a secret value to the platform
// cipher: that would need a rehearsed re-encryption, not a refactor.

const SRC = join(__dirname, '..', '..', 'src');

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

  it.each(['secrets', 'backups', 'media', 'secret-types'])(
    'src/%s never touches the platform cipher or credential store',
    (folder) => {
      const offenders = sourceFiles(join(SRC, folder)).filter((file) =>
        /platform-api\/credentials|encryptSecret|decryptSecret|SECRETS_ENCRYPTION_KEY|CredentialsService/.test(
          readFileSync(file, 'utf8'),
        ),
      );
      expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
    },
  );

  it('the secret-version writers encrypt through CryptoService', () => {
    const service = readFileSync(join(SRC, 'secrets', 'secrets.service.ts'), 'utf8');
    expect(service).toMatch(/CryptoService/);
    expect(service).toMatch(/crypto\.encrypt\(/);
  });

  it('only the AI key presence reader and the legacy key migration read the credential store in application code', () => {
    const readers = sourceFiles(SRC)
      .filter((file) => /import(?:\s+type)?\s*\{[^}]*\bCredentialsService\b[^}]*\}\s*from/.test(readFileSync(file, 'utf8')))
      .map((f) => relative(SRC, f))
      .sort();
    expect(readers).toEqual([
      'ai/ai-key-migration.ts',
      'platform/credentials/ai-key-presence.service.ts',
    ]);
  });
});
