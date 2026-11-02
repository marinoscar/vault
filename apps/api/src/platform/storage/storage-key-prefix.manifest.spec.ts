// Vault's object-key prefixes (issue #84, E6.1): every prefix Vault writes under is
// registered so a purge reaches it, and the key builders the backups use produce
// exactly what the registry builds (existing keys must not change).

import { allKeyPrefixes, buildObjectKey, isRegisteredStorageKey, orgKeyPrefixes } from '@marinoscar/platform-api/storage';

import { systemBackupStorageKey, userBackupStorageKey } from '../../backups/backup-archive';
import './storage-key-prefix.manifest';

const USER = '3f2b8f0e-6c1d-4f4b-9a55-1c2d3e4f5a6b';
const RUN = '9d8c7b6a-1234-4abc-8def-0123456789ab';
const WHEN = new Date('2026-06-10T12:34:56.000Z');

describe('storage key prefixes', () => {
  it('registers the platform six, Vault\'s two backup prefixes and the exports slice\'s two', () => {
    const prefixes = allKeyPrefixes();
    for (const prefix of ['uploads/', 'avatars/', 'node-outputs/', 'storage-config-test/', 'system-backups/', 'user-backups/', 'exports/users/', 'exports/orgs/']) {
      expect(prefixes).toContain(prefix);
    }
  });

  it('registers the db-backup slice\'s database-backups/ prefix once, with deployment scope (E9.1)', () => {
    expect(allKeyPrefixes().filter((prefix) => prefix === 'database-backups/')).toHaveLength(1);
    expect(isRegisteredStorageKey('database-backups/vault/2027/01/vault-20270102T030000Z-9d8c7b6a.dump')).toBe(true);
  });

  it('keeps the system backup key layout', () => {
    expect(systemBackupStorageKey(WHEN, RUN)).toBe(buildObjectKey('system-backups', {}, 'vault-backup-2026-06-10_123456-9d8c7b6a.zip'));
  });

  it('keeps the user backup key layout (user scope: user-backups/<userId>/<file>)', () => {
    expect(userBackupStorageKey(USER, WHEN, RUN)).toBe(
      buildObjectKey('user-backups', { userId: USER }, 'vault-backup-2026-06-10_123456-9d8c7b6a.zip'),
    );
  });

  it('recognises every key Vault writes, including legacy uploads without an org segment', () => {
    expect(isRegisteredStorageKey(systemBackupStorageKey(WHEN, RUN))).toBe(true);
    expect(isRegisteredStorageKey(userBackupStorageKey(USER, WHEN, RUN))).toBe(true);
    expect(isRegisteredStorageKey('uploads/1717000000000/0b1c2d3e-0000-4000-8000-000000000000.pdf')).toBe(true);
    expect(isRegisteredStorageKey('uploads/org-id/1717000000000/0b1c2d3e-0000-4000-8000-000000000000.pdf')).toBe(true);
  });

  it('lists an organization\'s uploads and exports under its own segment only', () => {
    expect(orgKeyPrefixes('org-1')).toEqual(['uploads/org-1/', 'exports/orgs/org-1/']);
  });
});
