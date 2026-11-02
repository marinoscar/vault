// Vault's two Doctor checks (issue #76): the pure rules, then the platform's
// check kit (identity, a guarded run, a valid outcome, READ-ONLY against a
// recording Prisma client, no secret material) over each check.

import { ConfigService } from '@nestjs/config';
import { DoctorCheckRegistry } from '@marinoscar/platform-api/doctor';
import { describeDoctorCheckConformance } from '@marinoscar/platform-api/doctor/testing';
import type { DoctorCheckFactory } from '@marinoscar/platform-api/doctor/testing';

import { CryptoService } from '../../src/common/services/crypto.service';
import {
  decideBackupSchedule,
  schedulePeriodMs,
  VaultBackupScheduleDoctorCheck,
  type BackupScheduleFacts,
} from '../../src/doctor/checks/vault-backup-schedule.doctor-check';
import {
  decideEncryptionKey,
  VaultEncryptionKeyDoctorCheck,
} from '../../src/doctor/checks/vault-encryption-key.doctor-check';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

function cryptoWith(keyHex: string): CryptoService {
  const service = new CryptoService({ get: () => keyHex } as unknown as ConfigService);
  service.onModuleInit();
  return service;
}

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-06-10T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('decideEncryptionKey', () => {
  it('fails when the key is unusable', () => {
    const out = decideEncryptionKey({ keyUnavailable: true });
    expect(out.status).toBe('fail');
    expect(out.remedy).toContain('VAULT_ENCRYPTION_KEY');
  });

  it('fails when the canary does not round trip', () => {
    expect(decideEncryptionKey({ canaryRoundTrip: false, storedVersionDecrypts: null }).status).toBe('fail');
  });

  it('fails when the key cannot decrypt stored data (rotated or replaced)', () => {
    const out = decideEncryptionKey({ canaryRoundTrip: true, storedVersionDecrypts: false });
    expect(out.status).toBe('fail');
    expect(out.remedy).toBeDefined();
  });

  it('passes with a verified stored version, and when there is nothing stored yet', () => {
    expect(decideEncryptionKey({ canaryRoundTrip: true, storedVersionDecrypts: true }).status).toBe('pass');
    const empty = decideEncryptionKey({ canaryRoundTrip: true, storedVersionDecrypts: null });
    expect(empty.status).toBe('pass');
    expect(empty.data).toMatchObject({ storedVersionChecked: false });
  });
});

describe('VaultEncryptionKeyDoctorCheck', () => {
  const sealed = cryptoWith(KEY_A).encrypt('stored-plaintext-that-must-not-leak');
  const version = { encryptedData: sealed.ciphertext, iv: sealed.iv, authTag: sealed.authTag };

  const build =
    (crypto: CryptoService): DoctorCheckFactory =>
    ({ prisma }) =>
      new VaultEncryptionKeyDoctorCheck(new DoctorCheckRegistry(), crypto, prisma.client as never);

  describeDoctorCheckConformance('vault.encryption_key', build(cryptoWith(KEY_A)), {
    scenarios: [
      {
        name: 'key decrypts the stored data',
        prisma: { results: { 'secretVersion.findFirst': version } },
        expectStatus: 'pass',
        secrets: ['stored-plaintext-that-must-not-leak', KEY_A],
      },
      {
        name: 'no stored data yet',
        prisma: { results: { 'secretVersion.findFirst': null } },
        expectStatus: 'pass',
        secrets: [KEY_A],
      },
      {
        name: 'key is not the one the data was written with',
        build: build(cryptoWith(KEY_B)),
        prisma: { results: { 'secretVersion.findFirst': version } },
        expectStatus: 'fail',
        secrets: ['stored-plaintext-that-must-not-leak', KEY_A, KEY_B],
      },
      {
        name: 'key is missing',
        build: build(new CryptoService({ get: () => '' } as unknown as ConfigService)),
        expectStatus: 'fail',
      },
    ],
  });
});

describe('decideBackupSchedule', () => {
  const daily: BackupScheduleFacts = { enabled: true, frequency: 'daily', intervalHours: null, nextRunAt: ago(-HOUR) };

  it('skips when the schedule is off or absent', () => {
    expect(decideBackupSchedule(null, null, NOW).status).toBe('skip');
    expect(decideBackupSchedule({ ...daily, enabled: false }, null, NOW).status).toBe('skip');
  });

  it('fails when the last scheduled run failed', () => {
    const out = decideBackupSchedule(daily, { status: 'failed', startedAt: ago(HOUR), finishedAt: ago(HOUR) }, NOW);
    expect(out.status).toBe('fail');
    expect(out.remedy).toBeDefined();
  });

  it('passes for a recent success and for a running backup', () => {
    expect(decideBackupSchedule(daily, { status: 'succeeded', startedAt: ago(2 * HOUR), finishedAt: ago(HOUR) }, NOW).status).toBe('pass');
    expect(decideBackupSchedule(daily, { status: 'running', startedAt: ago(HOUR), finishedAt: null }, NOW).status).toBe('pass');
  });

  it('warns when the last success is older than two periods', () => {
    const stale = ago(49 * HOUR);
    expect(decideBackupSchedule(daily, { status: 'succeeded', startedAt: stale, finishedAt: stale }, NOW).status).toBe('warn');
    const fresh = ago(47 * HOUR);
    expect(decideBackupSchedule(daily, { status: 'succeeded', startedAt: fresh, finishedAt: fresh }, NOW).status).toBe('pass');
  });

  it('warns about a run stuck in running', () => {
    expect(decideBackupSchedule(daily, { status: 'running', startedAt: ago(7 * HOUR), finishedAt: null }, NOW).status).toBe('warn');
  });

  it('with no run yet: passes before the first run is due, warns when it is overdue', () => {
    expect(decideBackupSchedule(daily, null, NOW).status).toBe('pass');
    expect(decideBackupSchedule({ ...daily, nextRunAt: ago(3 * HOUR) }, null, NOW).status).toBe('warn');
  });

  it('derives the period from the frequency', () => {
    expect(schedulePeriodMs({ frequency: 'hourly', intervalHours: 6 })).toBe(6 * HOUR);
    expect(schedulePeriodMs({ frequency: 'hourly', intervalHours: null })).toBe(HOUR);
    expect(schedulePeriodMs({ frequency: 'weekly', intervalHours: null })).toBe(7 * 24 * HOUR);
    expect(schedulePeriodMs({ frequency: 'monthly', intervalHours: null })).toBe(31 * 24 * HOUR);
    expect(schedulePeriodMs({ frequency: 'daily', intervalHours: null })).toBe(24 * HOUR);
  });

  it('never echoes the run error text', () => {
    const out = decideBackupSchedule(daily, { status: 'failed', startedAt: ago(HOUR), finishedAt: ago(HOUR) }, NOW);
    expect(out.error).toBeUndefined();
    expect(Object.keys(out.data ?? {}).sort()).toEqual(['enabled', 'frequency', 'lastRun', 'lastStartedAt']);
  });
});

describe('VaultBackupScheduleDoctorCheck', () => {
  const build: DoctorCheckFactory = ({ prisma }) =>
    new VaultBackupScheduleDoctorCheck(new DoctorCheckRegistry(), prisma.client as never);
  const enabled = { enabled: true, frequency: 'daily', intervalHours: null, nextRunAt: new Date(Date.now() + HOUR) };

  describeDoctorCheckConformance('vault.backup_schedule', build, {
    scenarios: [
      { name: 'schedule off', prisma: { results: { 'backupSchedule.findUnique': { ...enabled, enabled: false } } }, expectStatus: 'skip' },
      { name: 'no schedule row', prisma: { results: { 'backupSchedule.findUnique': null } }, expectStatus: 'skip' },
      {
        name: 'last run succeeded',
        prisma: {
          results: {
            'backupSchedule.findUnique': enabled,
            'backupRun.findFirst': { status: 'succeeded', startedAt: new Date(Date.now() - HOUR), finishedAt: new Date(Date.now() - HOUR) },
          },
        },
        expectStatus: 'pass',
      },
      {
        name: 'last run failed',
        prisma: {
          results: {
            'backupSchedule.findUnique': enabled,
            'backupRun.findFirst': { status: 'failed', startedAt: new Date(Date.now() - HOUR), finishedAt: new Date(Date.now() - HOUR) },
          },
        },
        expectStatus: 'fail',
      },
    ],
  });
});
