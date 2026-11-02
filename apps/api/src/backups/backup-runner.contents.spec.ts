import { defaultOrgMock } from '../../test/mocks/default-org.mock';
import { Readable } from 'stream';

import { Logger } from '@nestjs/common';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';

import { CryptoService } from '../common/services/crypto.service';
import { SecretsExportService } from '../secrets/export/secrets-export.service';
import { encryptBackupPassword } from './backup-password';
import { BACKUP_FAILURE_MESSAGES, BACKUP_SCHEDULE_ID, BackupRunnerService } from './backup-runner.service';
import type { BackupRunRow } from './dto/backup-responses';

/**
 * Content selection of the system backup, end to end through the real
 * SecretsExportService: media isolation between users, and redaction of the
 * system/ section.
 */

const PASSWORD = 'Contents-Pass-42';
const NOW = new Date('2026-06-01T12:00:00Z');
const KEY = 'system-backups/vault-backup-2026-06-01_120000.zip';

/** Values that must never appear in the system section. */
const MARKERS = {
  refreshToken: 'REFRESH-TOKEN-HASH-MARKER',
  pat: 'PAT-HASH-MARKER',
  providerSubject: 'PROVIDER-SUBJECT-MARKER',
  deviceCode: 'DEVICE-CODE-MARKER',
  apiKeyCiphertext: 'AI-KEY-CIPHERTEXT-MARKER',
  apiKeyLast4: 'L4X9',
  backupPassword: PASSWORD,
  secretValue: 'SECRET-VALUE-MARKER',
};

const crypto = new CryptoService({ get: () => 'e'.repeat(64) } as never);
beforeAll(() => {
  Logger.overrideLogger(false);
  crypto.onModuleInit();
});

const USERS = [
  {
    id: 'user-a',
    email: 'person.a@example.test',
    displayName: 'Person A',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    userRoles: [{ role: { name: 'Admin' } }],
    // Columns/relations the section must never copy, even if a row carries them.
    refreshTokens: [{ tokenHash: MARKERS.refreshToken }],
    personalAccessTokens: [{ tokenHash: MARKERS.pat }],
    identities: [{ provider: 'google', providerSubject: MARKERS.providerSubject }],
    deviceCodes: [{ deviceCode: MARKERS.deviceCode }],
  },
  {
    id: 'user-b',
    email: 'person.b@example.test',
    displayName: null,
    isActive: false,
    createdAt: new Date('2026-01-02T00:00:00Z'),
    userRoles: [{ role: { name: 'Viewer' } }],
  },
];

const FOLDERS = [
  { id: 'fa', userId: 'user-a', name: 'A Private Folder', file: 'a-only-video.mp4' },
  { id: 'fb', userId: 'user-b', name: 'B Private Folder', file: 'b-only-video.mp4' },
];

function mediaFolderFindMany({ where }: { where: { userId: string } }) {
  return FOLDERS.filter((f) => f.userId === where.userId).map((f) => ({
    id: f.id,
    name: f.name,
    userId: f.userId,
    createdAt: new Date('2026-02-01T00:00:00Z'),
    // media_folder_files link rows; the export flattens `object` back out.
    files: [
      {
        mediaFolderId: f.id,
        object: {
          id: `obj-${f.id}`,
          name: f.file,
          size: 3n,
          mimeType: 'video/mp4',
          storageKey: `media/${f.id}`,
          status: 'ready',
          createdAt: new Date('2026-02-02T00:00:00Z'),
        },
      },
    ],
  }));
}

function setup(schedule: Record<string, unknown>) {
  const uploads: Record<string, Buffer> = {};
  const prisma = {
    ...defaultOrgMock(),
    backupSchedule: {
      findUnique: jest.fn(async () => ({
        id: BACKUP_SCHEDULE_ID,
        keepCount: 7,
        includeAttachments: true,
        includeVersions: false,
        passwordEncrypted: encryptBackupPassword(crypto, PASSWORD),
        ...schedule,
      })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    backupRun: {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: { findMany: jest.fn().mockResolvedValue(USERS) },
    secret: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    mediaFolder: { findMany: jest.fn(mediaFolderFindMany) },
    storageObject: { aggregate: jest.fn().mockResolvedValue({ _sum: { size: 0 } }) },
    allowedEmail: {
      findMany: jest.fn().mockResolvedValue([
        {
          email: 'person.a@example.test',
          notes: 'first admin',
          addedAt: new Date('2026-01-01T00:00:00Z'),
          claimedAt: new Date('2026-01-01T01:00:00Z'),
          claimedById: 'user-a',
          addedBy: null,
        },
        {
          email: 'person.c@example.test',
          notes: null,
          addedAt: new Date('2026-01-03T00:00:00Z'),
          claimedAt: null,
          claimedById: null,
          addedBy: { email: 'person.a@example.test', id: 'user-a', refreshTokens: [MARKERS.refreshToken] },
        },
      ]),
    },
    secretType: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'type-custom',
          name: 'Locker Combination',
          description: null,
          icon: 'lock',
          fields: [{ name: 'code', label: 'Code', type: 'string', sensitive: true }],
          allowAttachments: false,
          createdAt: new Date('2026-01-05T00:00:00Z'),
          updatedAt: new Date('2026-01-05T00:00:00Z'),
          createdBy: { email: 'person.b@example.test' },
          isSystem: false,
        },
      ]),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const storage = {
    getBucket: jest.fn(() => 'bucket'),
    exists: jest.fn(async () => true),
    download: jest.fn(async (key: string) => Readable.from([Buffer.from(key.slice(-3))])),
    upload: jest.fn(async (key: string, stream: Readable) => {
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(Buffer.from(c));
      uploads[key] = Buffer.concat(chunks);
      return { key };
    }),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  // AiConfigService: whether an AI key is stored.
  const aiConfig = { isKeyConfigured: jest.fn(async () => true) };
  const systemSettings = {
    // What SystemSettingsService.getSettings() returns: already masked, but
    // still carrying apiKeyLast4, which the backup drops too.
    getSettings: jest.fn(async () => ({
      ui: { allowUserThemeOverride: true },
      features: { cardScanning: true },
      ai: {
        enabled: true,
        provider: 'openai',
        model: 'model-x',
        maxCallsPerUserPerDay: 20,
        apiKeyConfigured: true,
        apiKeyLast4: MARKERS.apiKeyLast4,
        apiKeyUpdatedAt: '2026-01-01T00:00:00.000Z',
        apiKey: { ciphertext: MARKERS.apiKeyCiphertext, iv: 'x', authTag: 'y' },
      },
      updatedAt: NOW,
      updatedBy: { id: 'user-a', email: 'person.a@example.test' },
      version: 3,
    })),
  };
  const exportService = new SecretsExportService(prisma as never, crypto, storage as never);
  const runner = new BackupRunnerService(
    prisma as never,
    crypto,
    storage as never,
    exportService,
    systemSettings as never,
    aiConfig as never,
  );
  return { runner, prisma, storage, uploads, systemSettings };
}

const runRow = (): BackupRunRow => ({
  id: 'run-1',
  status: 'running',
  trigger: 'manual',
  triggeredById: null,
  storageKey: KEY,
  sizeBytes: null,
  userCount: 0,
  secretCount: 0,
  attachmentCount: 0,
  warningCount: 0,
  error: null,
  startedAt: NOW,
  finishedAt: null,
  deletedAt: null,
});

async function openUpload(bytes: Buffer) {
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(bytes)));
  const entries = await reader.getEntries();
  const text = async (name: string) => {
    const entry = entries.find((e) => e.filename === name);
    if (!entry || entry.directory) throw new Error(`no entry ${name}`);
    return Buffer.from(await entry.getData(new Uint8ArrayWriter(), { password: PASSWORD })).toString('utf8');
  };
  return { names: entries.map((e) => e.filename).sort(), text, close: () => reader.close() };
}

describe('System backup content selection', () => {
  it('media only: one folder per user, each holding only that user\'s media', async () => {
    const ctx = setup({ includeSecrets: false, includeAttachments: false, includeMedia: true });
    await ctx.runner.execute(runRow());
    const zip = await openUpload(ctx.uploads[KEY]);

    expect(zip.names).toEqual([
      'README.txt',
      'index.json',
      'users/0001/media/0001/0001.mp4',
      'users/0001/media/media.json',
      'users/0002/media/0001/0001.mp4',
      'users/0002/media/media.json',
    ]);
    const a = await zip.text('users/0001/media/media.json');
    const b = await zip.text('users/0002/media/media.json');
    expect(a).toContain('a-only-video.mp4');
    expect(a).not.toContain('b-only-video.mp4');
    expect(a).not.toContain('B Private Folder');
    expect(b).toContain('b-only-video.mp4');
    expect(b).not.toContain('a-only-video.mp4');
    for (const call of ctx.prisma.mediaFolder.findMany.mock.calls) {
      expect(Object.keys(call[0].where)).toEqual(['userId']);
    }
    expect(ctx.prisma.secret.findMany).not.toHaveBeenCalled();

    const index = JSON.parse(await zip.text('index.json'));
    expect(index.options).toEqual({
      includeSecrets: false,
      includeAttachments: false,
      includeVersions: false,
      includeMedia: true,
      includeSystem: false,
    });
    expect(index.counts).toMatchObject({ users: 2, mediaFolders: 2, mediaFiles: 2, secrets: 0, system: false });
    expect(index.users.map((u: { folder: string }) => u.folder)).toEqual(['users/0001', 'users/0002']);

    const data = ctx.prisma.backupRun.update.mock.calls.at(-1)![0].data;
    expect(data).toMatchObject({ status: 'succeeded', mediaFileCount: 2, contents: ['media'] });
    expect(ctx.prisma.storageObject.aggregate.mock.calls[0][0].where).toEqual({
      status: 'ready',
      mediaFolderFile: { isNot: null },
    });
    await zip.close();
  });

  it('system only: system/*.json, no user folders, nothing sensitive', async () => {
    const ctx = setup({ includeSecrets: false, includeAttachments: false, includeSystem: true });
    await ctx.runner.execute(runRow());
    const zip = await openUpload(ctx.uploads[KEY]);

    expect(zip.names).toEqual([
      'README.txt',
      'index.json',
      'system/allowlist.json',
      'system/secret-types.json',
      'system/settings.json',
      'system/users.json',
    ]);

    const users = JSON.parse(await zip.text('system/users.json'));
    expect(users).toEqual([
      {
        id: 'user-a',
        email: 'person.a@example.test',
        displayName: 'Person A',
        isActive: true,
        roles: ['Admin'],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'user-b',
        email: 'person.b@example.test',
        displayName: null,
        isActive: false,
        roles: ['Viewer'],
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ]);
    const allowlist = JSON.parse(await zip.text('system/allowlist.json'));
    expect(allowlist.map((e: { status: string }) => e.status)).toEqual(['claimed', 'pending']);
    expect(allowlist[1].addedBy).toBe('person.a@example.test');
    const types = JSON.parse(await zip.text('system/secret-types.json'));
    expect(types).toHaveLength(1);
    expect(types[0]).toMatchObject({ name: 'Locker Combination', owner: 'person.b@example.test' });
    expect(ctx.prisma.secretType.findMany.mock.calls[0][0].where).toEqual({ isSystem: false });
    const settings = JSON.parse(await zip.text('system/settings.json'));
    expect(settings.ai).toEqual({
      enabled: true,
      provider: 'openai',
      model: 'model-x',
      maxCallsPerUserPerDay: 20,
      apiKeyConfigured: true,
    });

    let everything = '';
    for (const name of zip.names.filter((n) => n.startsWith('system/'))) {
      everything += await zip.text(name);
    }
    for (const marker of Object.values(MARKERS)) {
      expect(everything).not.toContain(marker);
    }
    for (const word of ['tokenHash', 'apiKeyLast4', 'apiKeyUpdatedAt', 'ciphertext', 'authTag', 'password', 'providerSubject']) {
      expect(everything).not.toContain(word);
    }

    const index = JSON.parse(await zip.text('index.json'));
    expect(index.counts.system).toBe(true);
    expect(index.users.every((u: { folder: string | null }) => u.folder === null)).toBe(true);
    expect(ctx.prisma.backupRun.update.mock.calls.at(-1)![0].data.contents).toEqual(['system']);
    expect(await zip.text('README.txt')).toContain('System:        included');
    await zip.close();
  });

  it('selects explicit columns for every system query', async () => {
    const ctx = setup({ includeSystem: true });
    await ctx.runner.execute(runRow());
    const systemUsersCall = ctx.prisma.user.findMany.mock.calls.find((c) => c[0].select.userRoles);
    expect(Object.keys(systemUsersCall![0].select).sort()).toEqual(
      ['createdAt', 'displayName', 'email', 'id', 'isActive', 'memberships', 'userRoles'].sort(),
    );
    expect(ctx.prisma.allowedEmail.findMany.mock.calls[0][0].select.addedBy).toEqual({ select: { email: true } });
    expect(ctx.prisma.secretType.findMany.mock.calls[0][0].select.createdBy).toEqual({ select: { email: true } });
  });

  it('default schedule (no new columns read) backs up secrets only', async () => {
    const ctx = setup({});
    await ctx.runner.execute(runRow());
    expect(ctx.prisma.mediaFolder.findMany).not.toHaveBeenCalled();
    expect(ctx.systemSettings.getSettings).not.toHaveBeenCalled();
    expect(ctx.prisma.backupRun.update.mock.calls.at(-1)![0].data.contents).toEqual(['secrets', 'attachments']);
    const audit = ctx.prisma.auditEvent.create.mock.calls.at(-1)![0].data.meta;
    expect(audit.contents).toEqual(['secrets', 'attachments']);
    expect(audit.counts.mediaFiles).toBe(0);
  });

  it('fails a run whose stored schedule selects nothing, without uploading', async () => {
    const ctx = setup({ includeSecrets: false, includeMedia: false, includeSystem: false });
    await ctx.runner.execute(runRow());
    expect(ctx.storage.upload).not.toHaveBeenCalled();
    expect(ctx.prisma.backupRun.update.mock.calls.at(-1)![0].data).toMatchObject({
      status: 'failed',
      error: BACKUP_FAILURE_MESSAGES.nothingSelected,
    });
  });

  it('streamSystemArchive writes the same layout as a scheduled run, stores nothing', async () => {
    const ctx = setup({});
    const selection = {
      includeSecrets: false,
      includeAttachments: false,
      includeVersions: false,
      includeMedia: true,
      includeSystem: true,
    };
    const stream = await ctx.runner.streamSystemArchive(selection, PASSWORD, NOW);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    const zip = await openUpload(Buffer.concat(chunks));
    expect(zip.names).toEqual([
      'README.txt',
      'index.json',
      'system/allowlist.json',
      'system/secret-types.json',
      'system/settings.json',
      'system/users.json',
      'users/0001/media/0001/0001.mp4',
      'users/0001/media/media.json',
      'users/0002/media/0001/0001.mp4',
      'users/0002/media/media.json',
    ]);
    expect(JSON.parse(await zip.text('index.json')).counts).toMatchObject({ mediaFiles: 2, system: true });
    expect(ctx.storage.upload).not.toHaveBeenCalled();
    expect(ctx.prisma.backupRun.update).not.toHaveBeenCalled();
    await zip.close();
  });

  it('countSystemArchive counts without decrypting any value', async () => {
    const ctx = setup({});
    const decrypt = jest.spyOn(crypto, 'decrypt');
    ctx.prisma.secret.findMany.mockResolvedValue([
      {
        id: 's1',
        name: 'Alpha',
        description: null,
        createdAt: NOW,
        updatedAt: NOW,
        type: { id: 't', name: 'Login', fields: [] },
        versions: [{ id: 'v1', version: 1, encryptedData: 'x', iv: 'y', authTag: 'z', createdAt: NOW, isCurrent: true }],
        attachments: [],
      },
    ]);
    const counts = await ctx.runner.countSystemArchive(
      { includeSecrets: true, includeAttachments: true, includeVersions: false, includeMedia: true, includeSystem: false },
      NOW,
    );
    expect(counts).toEqual({ userCount: 2, secretCount: 2, attachmentCount: 0, mediaFileCount: 2, warningCount: 0 });
    expect(decrypt).not.toHaveBeenCalled();
    decrypt.mockRestore();
  });
});
