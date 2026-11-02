// Vault's object-key prefixes (issue #84, E6.1): every prefix Vault writes under is
// registered so a purge reaches it, and the key builders the backups use produce
// exactly what the registry builds (existing keys must not change).

import { allKeyPrefixes, buildObjectKey, isRegisteredStorageKey, orgKeyPrefixes } from '@marinoscar/platform-api/storage';

import { systemBackupStorageKey, userBackupStorageKey } from '../../backups/backup-archive';
import './storage-key-prefix.manifest';

const USER = '3f2b8f0e-6c1d-4f4b-9a55-1c2d3e4f5a6b';
const WHEN = new Date('2026-06-10T12:34:56.000Z');

describe('storage key prefixes', () => {
  it('registers the platform six and Vault\'s two backup prefixes', () => {
    const prefixes = allKeyPrefixes();
    for (const prefix of ['uploads/', 'avatars/', 'node-outputs/', 'storage-config-test/', 'system-backups/', 'user-backups/']) {
      expect(prefixes).toContain(prefix);
    }
  });

  it('keeps the system backup key layout', () => {
    expect(systemBackupStorageKey(WHEN)).toBe(buildObjectKey('system-backups', {}, 'vault-backup-2026-06-10_123456.zip'));
  });

  it('keeps the user backup key layout (user scope: user-backups/<userId>/<file>)', () => {
    expect(userBackupStorageKey(USER, WHEN)).toBe(
      buildObjectKey('user-backups', { userId: USER }, 'vault-backup-2026-06-10_123456.zip'),
    );
  });

  it('recognises every key Vault writes, including legacy uploads without an org segment', () => {
    expect(isRegisteredStorageKey(systemBackupStorageKey(WHEN))).toBe(true);
    expect(isRegisteredStorageKey(userBackupStorageKey(USER, WHEN))).toBe(true);
    expect(isRegisteredStorageKey('uploads/1717000000000/0b1c2d3e-0000-4000-8000-000000000000.pdf')).toBe(true);
    expect(isRegisteredStorageKey('uploads/org-id/1717000000000/0b1c2d3e-0000-4000-8000-000000000000.pdf')).toBe(true);
  });

  it('lists an organization\'s uploads under its own segment only', () => {
    expect(orgKeyPrefixes('org-1')).toEqual(['uploads/org-1/']);
  });
});
