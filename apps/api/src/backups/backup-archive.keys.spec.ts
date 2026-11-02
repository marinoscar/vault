import { backupArchiveFileName, systemBackupStorageKey, userBackupStorageKey } from './backup-archive';

const WHEN = new Date('2026-07-01T10:00:00.000Z');
const RUN_A = '9d8c7b6a-1234-4abc-8def-0123456789ab';
const RUN_B = '11112222-1234-4abc-8def-0123456789ab';
const USER = '3f2b8f0e-6c1d-4f4b-9a55-1c2d3e4f5a6b';

describe('backup archive keys (#130)', () => {
  it('embeds the timestamp and the short run id', () => {
    expect(backupArchiveFileName(WHEN, RUN_A)).toBe('vault-backup-2026-07-01_100000-9d8c7b6a.zip');
    expect(systemBackupStorageKey(WHEN, RUN_A)).toBe('system-backups/vault-backup-2026-07-01_100000-9d8c7b6a.zip');
    expect(userBackupStorageKey(USER, WHEN, RUN_A)).toBe(`user-backups/${USER}/vault-backup-2026-07-01_100000-9d8c7b6a.zip`);
  });

  it('gives two runs of one scope in the same second distinct keys', () => {
    expect(systemBackupStorageKey(WHEN, RUN_A)).not.toBe(systemBackupStorageKey(WHEN, RUN_B));
    expect(userBackupStorageKey(USER, WHEN, RUN_A)).not.toBe(userBackupStorageKey(USER, WHEN, RUN_B));
  });
});
