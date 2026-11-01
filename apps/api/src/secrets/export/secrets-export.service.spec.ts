import { Readable } from 'stream';

import { Logger } from '@nestjs/common';

import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';

import { CryptoService } from '../../common/services/crypto.service';
import {
  buildExportPlan,
  ExportSecretRow,
  ExportVersionRow,
  SecretsExportService,
} from './secrets-export.service';

const PASSWORD = 'correct horse battery staple';
const KEY_HEX = 'ab'.repeat(32);

const crypto = new CryptoService({ get: () => KEY_HEX } as never);
crypto.onModuleInit();

const USER = { id: 'user-1', email: 'person.a@example.test' };
const SECRET_NAME_A = 'Zebra Bank Login';
const SECRET_NAME_B = 'Amber Visa Card';
const LABEL = 'Front of Amber card';
const ORIGINAL_NAME = 'my-private-scan.jpg';

function version(
  id: string,
  n: number,
  data: Record<string, unknown>,
  isCurrent: boolean,
): ExportVersionRow {
  const enc = crypto.encrypt(JSON.stringify(data));
  return {
    id,
    version: n,
    encryptedData: enc.ciphertext,
    iv: enc.iv,
    authTag: enc.authTag,
    createdAt: new Date(Date.UTC(2026, 0, n)),
    isCurrent,
  };
}

function storageObject(id: string, over: Partial<{ status: string; mimeType: string; name: string }> = {}) {
  return {
    id,
    name: over.name ?? ORIGINAL_NAME,
    size: 5n,
    mimeType: over.mimeType ?? 'image/jpeg',
    storageKey: `key/${id}`,
    status: over.status ?? 'ready',
  };
}

function baseRows(): ExportSecretRow[] {
  return [
    {
      id: 'sec-a',
      name: SECRET_NAME_A,
      description: 'desc',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-05T00:00:00Z'),
      type: {
        id: 'type-1',
        name: 'Login',
        fields: [{ name: 'user', label: 'Username', type: 'string' }],
      },
      versions: [
        version('a-v2', 2, { user: 'new-user' }, true),
        version('a-v1', 1, { user: 'old-user' }, false),
      ],
      attachments: [],
    },
    {
      id: 'sec-b',
      name: SECRET_NAME_B,
      description: null,
      createdAt: new Date('2026-01-02T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
      type: { id: 'type-2', name: 'Card', fields: [{ name: 'number', label: 'Number', type: 'string' }] },
      versions: [version('b-v1', 1, { number: '4111' }, true)],
      attachments: [
        {
          id: 'att-1',
          secretVersionId: 'b-v1',
          storageObjectId: 'obj-1',
          role: 'card_front',
          label: LABEL,
          createdAt: new Date('2026-01-02T00:00:01Z'),
          storageObject: storageObject('obj-1'),
        },
      ],
    },
  ];
}

const BLOBS: Record<string, Buffer> = {
  'key/obj-1': Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]),
};

function makeService(rows: ExportSecretRow[], storage: Partial<Record<string, jest.Mock>> = {}) {
  const prisma = {
    secret: { findMany: jest.fn().mockResolvedValue(rows) },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const storageProvider = {
    exists: storage.exists ?? jest.fn(async () => true),
    download:
      storage.download ??
      jest.fn(async (key: string) => Readable.from([BLOBS[key] ?? Buffer.from('x')])),
  };
  const service = new SecretsExportService(prisma as never, crypto, storageProvider as never);
  return { service, prisma, storageProvider };
}

async function collect(stream: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return new Uint8Array(Buffer.concat(chunks));
}

async function openZip(bytes: Uint8Array) {
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  const entries = await reader.getEntries();
  const read = async (name: string, password: string = PASSWORD) => {
    const entry = entries.find((e) => e.filename === name);
    if (!entry || entry.directory) throw new Error(`no entry ${name}`);
    return entry.getData(new Uint8ArrayWriter(), { password });
  };
  const text = async (name: string, password?: string) =>
    Buffer.from(await read(name, password)).toString('utf8');
  return { entries, read, text, close: () => reader.close() };
}

async function exportZip(
  rows: ExportSecretRow[],
  opts: { includeAttachments?: boolean; includeVersions?: boolean } = {},
  storage: Partial<Record<string, jest.Mock>> = {},
) {
  const ctx = makeService(rows, storage);
  const result = await ctx.service.createExport(USER, {
    password: PASSWORD,
    includeAttachments: opts.includeAttachments ?? true,
    includeVersions: opts.includeVersions ?? false,
  });
  const bytes = await collect(result.stream);
  return { ...ctx, result, bytes };
}

beforeAll(() => {
  Logger.overrideLogger(false);
});

describe('buildExportPlan', () => {
  const decrypt = (v: ExportVersionRow) =>
    JSON.parse(crypto.decrypt(v.encryptedData, v.iv, v.authTag));
  const input = (over: Record<string, unknown> = {}) => ({
    owner: USER,
    options: { includeAttachments: true, includeVersions: false },
    exportedAt: new Date('2026-02-03T04:05:06Z'),
    decrypt,
    ...over,
  });

  it('builds counts, owner and options', () => {
    const { manifest, files } = buildExportPlan(baseRows(), input());
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.app).toBe('vault');
    expect(manifest.owner).toEqual(USER);
    expect(manifest.counts).toEqual({ secrets: 2, attachments: 1 });
    expect(manifest.exportedAt).toBe('2026-02-03T04:05:06.000Z');
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('attachments/0002-01.jpg');
    expect(manifest.secrets[1].current?.attachments[0].file).toBe('attachments/0002-01.jpg');
  });

  it('exports only the current version unless includeVersions', () => {
    const { manifest } = buildExportPlan(baseRows(), input());
    expect(manifest.secrets[0].current?.versionNumber).toBe(2);
    expect(manifest.secrets[0].current?.data).toEqual({ user: 'new-user' });
    expect(manifest.secrets[0].versions).toBeUndefined();
  });

  it('lists versions oldest first when includeVersions', () => {
    const { manifest } = buildExportPlan(
      baseRows(),
      input({ options: { includeAttachments: true, includeVersions: true } }),
    );
    expect(manifest.secrets[0].versions?.map((v) => v.versionNumber)).toEqual([1, 2]);
    expect(manifest.secrets[0].versions?.[0].data).toEqual({ user: 'old-user' });
    expect(manifest.secrets[0].current?.versionNumber).toBe(2);
  });

  it('dedupes attachments that share a storage object across versions', () => {
    const rows = baseRows();
    rows[1].versions = [version('b-v2', 2, { number: '5555' }, true), version('b-v1', 1, { number: '4111' }, false)];
    const shared = (id: string, versionId: string, sec: number) => ({
      id,
      secretVersionId: versionId,
      storageObjectId: 'obj-1',
      role: 'card_front',
      label: null,
      createdAt: new Date(Date.UTC(2026, 0, sec)),
      storageObject: storageObject('obj-1'),
    });
    rows[1].attachments = [shared('x1', 'b-v1', 1), shared('x2', 'b-v2', 2)];

    const { manifest, files } = buildExportPlan(
      rows,
      input({ options: { includeAttachments: true, includeVersions: true } }),
    );

    expect(files).toHaveLength(1);
    expect(manifest.counts.attachments).toBe(1);
    const [oldV, newV] = manifest.secrets[1].versions!;
    expect(oldV.attachments[0].file).toBe(newV.attachments[0].file);
  });

  it('decrypt failure gives data {} and a warning, and calls the hook with ids only', () => {
    const onDecryptFailure = jest.fn();
    const { manifest } = buildExportPlan(
      baseRows(),
      input({
        decrypt: (v: ExportVersionRow) => {
          if (v.id === 'a-v2') throw new Error('bad tag');
          return decrypt(v);
        },
        onDecryptFailure,
      }),
    );
    expect(manifest.secrets[0].current?.data).toEqual({});
    expect(manifest.warnings).toHaveLength(1);
    expect(manifest.warnings[0]).toContain('could not be decrypted');
    expect(onDecryptFailure).toHaveBeenCalledWith('sec-a', 'a-v2');
    expect(manifest.secrets[1].current?.data).toEqual({ number: '4111' });
  });

  it('keeps an attachment whose upload is not ready with file null and a warning', () => {
    const rows = baseRows();
    rows[1].attachments![0].storageObject = storageObject('obj-1', { status: 'uploading' });
    const { manifest, files } = buildExportPlan(rows, input());
    expect(files).toHaveLength(0);
    expect(manifest.counts.attachments).toBe(0);
    expect(manifest.secrets[1].current?.attachments[0].file).toBeNull();
    expect(manifest.warnings[0]).toContain('upload never completed');
  });

  it('keeps an attachment whose storage object row is missing with file null', () => {
    const rows = baseRows();
    rows[1].attachments![0].storageObject = null;
    const { manifest } = buildExportPlan(rows, input());
    expect(manifest.secrets[1].current?.attachments[0].file).toBeNull();
    expect(manifest.warnings).toHaveLength(1);
  });

  it('ignores attachments when includeAttachments is false', () => {
    const { manifest, files } = buildExportPlan(
      baseRows(),
      input({ options: { includeAttachments: false, includeVersions: false } }),
    );
    expect(files).toHaveLength(0);
    expect(manifest.secrets[1].current?.attachments).toEqual([]);
  });
});

describe('SecretsExportService', () => {
  describe('archive format', () => {
    it('produces an AES-256 (never ZipCrypto) archive with every entry encrypted', async () => {
      const { bytes } = await exportZip(baseRows());
      const zip = await openZip(bytes);

      expect(zip.entries.map((e) => e.filename).sort()).toEqual([
        'README.txt',
        'attachments/0002-01.jpg',
        'secrets.html',
        'secrets.json',
      ]);
      for (const entry of zip.entries) {
        expect(entry.encrypted).toBe(true);
        expect(entry.zipCrypto).toBe(false);
        expect(entry.extraFieldAES?.strength).toBe(3);
      }
      await zip.close();
    });

    it('round-trips secrets.json and attachment bytes with the right password', async () => {
      const { bytes, result } = await exportZip(baseRows());
      const zip = await openZip(bytes);

      const json = JSON.parse(await zip.text('secrets.json'));
      expect(json.formatVersion).toBe(1);
      expect(json.counts).toEqual({ secrets: 2, attachments: 1 });
      expect(json.secrets.map((s: { name: string }) => s.name)).toEqual([
        SECRET_NAME_A,
        SECRET_NAME_B,
      ]);
      expect(json.secrets[0].current.data).toEqual({ user: 'new-user' });
      expect(json.secrets[1].current.attachments[0]).toMatchObject({
        file: 'attachments/0002-01.jpg',
        role: 'card_front',
        label: LABEL,
        originalName: ORIGINAL_NAME,
        mimeType: 'image/jpeg',
      });

      const blob = await zip.read('attachments/0002-01.jpg');
      expect(Buffer.from(blob).equals(BLOBS['key/obj-1'])).toBe(true);
      expect(await zip.text('secrets.html')).toContain(SECRET_NAME_B);
      expect(await zip.text('README.txt')).toContain('VAULT BACKUP');
      expect(result.fileName).toMatch(/^vault-backup-\d{4}-\d{2}-\d{2}\.zip$/);
      expect(result.secretCount).toBe(2);
      expect(result.attachmentCount).toBe(1);
      await zip.close();
    });

    it('fails to read with the wrong password', async () => {
      const { bytes } = await exportZip(baseRows());
      const zip = await openZip(bytes);

      await expect(zip.read('secrets.json', 'wrong password')).rejects.toThrow();
      await expect(zip.read('attachments/0002-01.jpg', 'wrong password')).rejects.toThrow();
      await zip.close();
    });

    it('keeps secret names, labels and original file names out of zip entry names', async () => {
      const { bytes } = await exportZip(baseRows());
      const zip = await openZip(bytes);
      const names = zip.entries.map((e) => e.filename).join('\n');

      for (const leaked of [SECRET_NAME_A, SECRET_NAME_B, LABEL, ORIGINAL_NAME, 'card_front', 'private', 'Amber']) {
        expect(names).not.toContain(leaked);
      }
      await zip.close();
    });

    it('never puts the password in the archive bytes', async () => {
      const { bytes } = await exportZip(baseRows());
      expect(Buffer.from(bytes).includes(Buffer.from(PASSWORD))).toBe(false);
    });

    it('does not leave secret values readable in the raw bytes', async () => {
      const { bytes } = await exportZip(baseRows());
      const raw = Buffer.from(bytes);
      expect(raw.includes(Buffer.from('new-user'))).toBe(false);
      expect(raw.includes(Buffer.from(SECRET_NAME_A))).toBe(false);
    });
  });

  describe('options', () => {
    it('includeAttachments=false writes no attachments/ entries and does not touch storage', async () => {
      const { bytes, storageProvider, result } = await exportZip(baseRows(), {
        includeAttachments: false,
      });
      const zip = await openZip(bytes);

      expect(zip.entries.filter((e) => e.filename.startsWith('attachments/'))).toHaveLength(0);
      expect(result.attachmentCount).toBe(0);
      expect(storageProvider.download).not.toHaveBeenCalled();
      expect(storageProvider.exists).not.toHaveBeenCalled();
      const json = JSON.parse(await zip.text('secrets.json'));
      expect(json.options.includeAttachments).toBe(false);
      await zip.close();
    });

    it('includeVersions=true adds versions oldest first to secrets.json', async () => {
      const { bytes } = await exportZip(baseRows(), { includeVersions: true });
      const zip = await openZip(bytes);
      const json = JSON.parse(await zip.text('secrets.json'));
      expect(json.secrets[0].versions.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([1, 2]);
      await zip.close();
    });
  });

  describe('query', () => {
    it('filters on createdById for the caller', async () => {
      const { prisma } = await exportZip(baseRows());
      expect(prisma.secret.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.secret.findMany.mock.calls[0][0].where).toEqual({ createdById: USER.id });
    });

    it('filters on the caller even when the user holds secrets:read_any', async () => {
      const ctx = makeService(baseRows());
      const admin = { ...USER, permissions: ['secrets:read', 'secrets:read_any'] };
      const result = await ctx.service.createExport(admin, {
        password: PASSWORD,
        includeAttachments: true,
        includeVersions: false,
      });
      await collect(result.stream);
      expect(ctx.prisma.secret.findMany.mock.calls[0][0].where).toEqual({ createdById: USER.id });
    });

    it('restricts to current versions and their attachments by default', async () => {
      const { prisma } = await exportZip(baseRows());
      const args = prisma.secret.findMany.mock.calls[0][0];
      expect(args.include.versions.where).toEqual({ isCurrent: true });
      expect(args.include.attachments.where).toEqual({ secretVersion: { isCurrent: true } });
    });

    it('loads every version when includeVersions, and no attachments when excluded', async () => {
      const a = await exportZip(baseRows(), { includeVersions: true });
      const argsA = a.prisma.secret.findMany.mock.calls[0][0];
      expect(argsA.include.versions.where).toBeUndefined();
      expect(argsA.include.attachments.where).toBeUndefined();

      const b = await exportZip(baseRows(), { includeAttachments: false });
      expect(b.prisma.secret.findMany.mock.calls[0][0].include.attachments).toBeUndefined();
    });
  });

  describe('audit', () => {
    it('writes a secrets.export event with counts and without the password', async () => {
      const { prisma } = await exportZip(baseRows(), { includeVersions: true });

      expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
      const arg = prisma.auditEvent.create.mock.calls[0][0];
      expect(arg.data).toMatchObject({
        actorUserId: USER.id,
        action: 'secrets.export',
        meta: {
          secretCount: 2,
          attachmentCount: 1,
          includeVersions: true,
          includeAttachments: true,
          warningCount: 0,
        },
      });
      expect(JSON.stringify(arg)).not.toContain(PASSWORD);
    });

    it('does not log the password', async () => {
      const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) =>
        jest.spyOn(Logger.prototype, m).mockImplementation(() => undefined),
      );
      try {
        await exportZip(baseRows(), {}, { download: jest.fn().mockRejectedValue(new Error('boom')) });
        const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
        expect(logged).not.toContain(PASSWORD);
        expect(logged).not.toContain(SECRET_NAME_B);
        expect(logged).not.toContain(ORIGINAL_NAME);
      } finally {
        spies.forEach((s) => s.mockRestore());
      }
    });
  });

  describe('storage failures', () => {
    it('skips a blob that fails to open, warns, and the archive still opens', async () => {
      const download = jest.fn().mockRejectedValue(new Error('storage down'));
      const { bytes, prisma } = await exportZip(baseRows(), {}, { download });
      const zip = await openZip(bytes);

      expect(zip.entries.some((e) => e.filename.startsWith('attachments/'))).toBe(false);
      const json = JSON.parse(await zip.text('secrets.json'));
      expect(json.counts.attachments).toBe(0);
      expect(json.secrets[1].current.attachments[0].file).toBeNull();
      expect(json.warnings).toHaveLength(1);
      expect(json.warnings[0]).toContain('could not be read from storage');
      expect(await zip.text('README.txt')).toContain('could not be read from storage');
      expect(await zip.text('secrets.html')).toContain('Not included');
      // Audit was written before streaming started, with the pre-stream counts.
      expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
      await zip.close();
    });

    it('drops a blob missing from storage in the pre-flight, before any byte is sent', async () => {
      const exists = jest.fn().mockResolvedValue(false);
      const ctx = makeService(baseRows(), { exists });
      const result = await ctx.service.createExport(USER, {
        password: PASSWORD,
        includeAttachments: true,
        includeVersions: false,
      });

      expect(result.attachmentCount).toBe(0);
      expect(result.warningCount).toBe(1);
      expect(ctx.prisma.auditEvent.create.mock.calls[0][0].data.meta).toMatchObject({
        attachmentCount: 0,
        warningCount: 1,
      });
      const zip = await openZip(await collect(result.stream));
      expect(zip.entries.some((e) => e.filename.startsWith('attachments/'))).toBe(false);
      await zip.close();
    });

    it('skips a blob whose source stream errors part way and still produces a valid archive', async () => {
      const download = jest.fn(async () => {
        let sent = false;
        return new Readable({
          read() {
            if (!sent) {
              sent = true;
              this.push(Buffer.from('partial'));
            } else {
              this.destroy(new Error('connection reset'));
            }
          },
        });
      });
      const { bytes } = await exportZip(baseRows(), {}, { download });
      const zip = await openZip(bytes);

      expect(zip.entries.some((e) => e.filename.startsWith('attachments/'))).toBe(false);
      const json = JSON.parse(await zip.text('secrets.json'));
      expect(json.secrets[1].current.attachments[0].file).toBeNull();
      expect(json.warnings).toHaveLength(1);
      await zip.close();
    });
  });

  it('produces a valid archive for a user with no secrets', async () => {
    const { bytes, result } = await exportZip([]);
    const zip = await openZip(bytes);
    expect(result.secretCount).toBe(0);
    const json = JSON.parse(await zip.text('secrets.json'));
    expect(json.secrets).toEqual([]);
    await zip.close();
  });
});
