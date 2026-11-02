import { defaultOrgMock } from '../../../test/mocks/default-org.mock';
import { Readable } from 'stream';

import { Logger } from '@nestjs/common';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';


import { ExportMediaFolderRow } from './media-export';
import { CreateExportOptions, SecretsExportService } from './secrets-export.service';
import { TestCrypto, auditOverPrisma } from '../../testing';

const PASSWORD = 'media-pass-123';
const USER = { id: 'user-1', email: 'person.a@example.test' };
const FOLDER_NAME = 'Summer Trip Folder';
const FILE_NAME = 'beach-day.mp4';

const crypto = new TestCrypto('cd'.repeat(32));
crypto.onModuleInit();

beforeAll(() => Logger.overrideLogger(false));

const mediaRow = (over: Partial<ExportMediaFolderRow> = {}): ExportMediaFolderRow => ({
  id: 'folder-1',
  name: FOLDER_NAME,
  userId: USER.id,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  files: [
    {
      id: 'obj-m1',
      name: FILE_NAME,
      size: 4n,
      mimeType: 'video/mp4',
      storageKey: 'key/obj-m1',
      status: 'ready',
      mediaFolderId: 'folder-1',
      createdAt: new Date('2026-01-02T00:00:00Z'),
    },
  ],
  ...over,
});

/**
 * What prisma.mediaFolder.findMany returns now: each folder's files are
 * media_folder_files link rows carrying the storage object under `object`
 * (the service flattens them back to ExportMediaFolderRow).
 */
const asLinkRows = (folders: ExportMediaFolderRow[]) =>
  folders.map((folder) => ({
    ...folder,
    files: folder.files.map(({ mediaFolderId, ...object }) => ({ mediaFolderId, object })),
  }));

function makeService(folders: ExportMediaFolderRow[], storage: Partial<Record<string, jest.Mock>> = {}) {
  const prisma = {
    ...defaultOrgMock(),
    secret: { findMany: jest.fn().mockResolvedValue([]) },
    mediaFolder: { findMany: jest.fn().mockResolvedValue(asLinkRows(folders)) },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const storageProvider = {
    exists: storage.exists ?? jest.fn(async () => true),
    download: storage.download ?? jest.fn(async () => Readable.from([Buffer.from([1, 2, 3, 4])])),
  };
  const service = new SecretsExportService(prisma as never, crypto, storageProvider as never, auditOverPrisma(prisma));
  return { service, prisma, storageProvider };
}

async function exportZip(
  folders: ExportMediaFolderRow[],
  options: Partial<CreateExportOptions>,
  storage: Partial<Record<string, jest.Mock>> = {},
) {
  const ctx = makeService(folders, storage);
  const result = await ctx.service.createExport(USER, {
    password: PASSWORD,
    includeAttachments: true,
    includeVersions: false,
    ...options,
  });
  const chunks: Buffer[] = [];
  for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(Buffer.concat(chunks))));
  const entries = await reader.getEntries();
  const text = async (name: string) => {
    const entry = entries.find((e) => e.filename === name);
    if (!entry || entry.directory) throw new Error(`no entry ${name}`);
    return Buffer.from(await entry.getData(new Uint8ArrayWriter(), { password: PASSWORD })).toString('utf8');
  };
  return { ...ctx, result, names: entries.map((e) => e.filename), text, close: () => reader.close() };
}

describe('SecretsExportService media library', () => {
  it('media only: README + media/, no secrets.html / secrets.json, no secrets query', async () => {
    const zip = await exportZip([mediaRow()], { includeSecrets: false, includeAttachments: false, includeMedia: true });

    expect(zip.names.sort()).toEqual(['README.txt', 'media/0001/0001.mp4', 'media/media.json']);
    expect(zip.prisma.secret.findMany).not.toHaveBeenCalled();
    const media = JSON.parse(await zip.text('media/media.json'));
    expect(media).toEqual({
      folders: [
        {
          folder: 'media/0001',
          name: FOLDER_NAME,
          createdAt: '2026-01-01T00:00:00.000Z',
          files: [
            {
              file: 'media/0001/0001.mp4',
              originalName: FILE_NAME,
              mimeType: 'video/mp4',
              size: 4,
              createdAt: '2026-01-02T00:00:00.000Z',
            },
          ],
        },
      ],
      warnings: [],
    });
    const readme = await zip.text('README.txt');
    expect(readme).toContain('Contents:      media library');
    expect(readme).toContain('Secrets:       not included');
    expect(readme).toContain('Media:         1 file(s) in 1 folder(s)');
    expect(zip.result).toMatchObject({ secretCount: 0, attachmentCount: 0, mediaFileCount: 1 });
    await zip.close();
  });

  it('secrets + media: both parts, options recorded in secrets.json', async () => {
    const zip = await exportZip([mediaRow()], { includeMedia: true });
    expect(zip.names).toEqual(
      expect.arrayContaining(['README.txt', 'secrets.json', 'secrets.html', 'media/media.json', 'media/0001/0001.mp4']),
    );
    expect(JSON.parse(await zip.text('secrets.json')).options).toEqual({
      includeSecrets: true,
      includeAttachments: true,
      includeVersions: false,
      includeMedia: true,
    });
    await zip.close();
  });

  it('default export does not query media at all', async () => {
    const zip = await exportZip([mediaRow()], {});
    expect(zip.prisma.mediaFolder.findMany).not.toHaveBeenCalled();
    expect(zip.names.some((n) => n.startsWith('media/'))).toBe(false);
    expect(await zip.text('README.txt')).toContain('Media:         not included');
    await zip.close();
  });

  it("queries only the caller's own folders and ready files", async () => {
    const zip = await exportZip([mediaRow()], { includeMedia: true });
    const args = zip.prisma.mediaFolder.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ userId: USER.id });
    expect(args.select.files.where).toEqual({ object: { status: 'ready' } });
    await zip.close();
  });

  it("never writes another user's media, even if the query returned it", async () => {
    const foreign = mediaRow({
      id: 'folder-x',
      userId: 'someone-else',
      name: 'Foreign Folder',
      files: [{ ...mediaRow().files[0], id: 'obj-x', storageKey: 'key/obj-x', mediaFolderId: 'folder-x', name: 'foreign.mp4' }],
    });
    const zip = await exportZip([mediaRow(), foreign], { includeMedia: true });
    const media = await zip.text('media/media.json');
    expect(media).not.toContain('Foreign Folder');
    expect(media).not.toContain('foreign.mp4');
    expect(zip.storageProvider.download).toHaveBeenCalledTimes(1);
    expect(zip.storageProvider.download).toHaveBeenCalledWith('key/obj-m1');
    expect(zip.result.mediaFileCount).toBe(1);
    await zip.close();
  });

  it('skips a media blob missing from storage with a warning', async () => {
    const zip = await exportZip([mediaRow()], { includeSecrets: false, includeAttachments: false, includeMedia: true }, {
      exists: jest.fn(async () => false),
    });
    expect(zip.result.mediaFileCount).toBe(0);
    expect(zip.result.warningCount).toBe(1);
    const media = JSON.parse(await zip.text('media/media.json'));
    expect(media.folders[0].files[0].file).toBeNull();
    expect(media.warnings[0]).toContain('could not be read from storage');
    expect(await zip.text('README.txt')).toContain('could not be read from storage');
    expect(zip.names).not.toContain('media/0001/0001.mp4');
    await zip.close();
  });

  it('skips a media blob whose download fails mid-archive', async () => {
    const zip = await exportZip([mediaRow()], { includeSecrets: false, includeAttachments: false, includeMedia: true }, {
      download: jest.fn().mockRejectedValue(new Error('storage down')),
    });
    const media = JSON.parse(await zip.text('media/media.json'));
    expect(media.folders[0].files[0].file).toBeNull();
    expect(zip.names).not.toContain('media/0001/0001.mp4');
    await zip.close();
  });

  it('keeps folder and file names out of zip entry names', async () => {
    const zip = await exportZip([mediaRow()], { includeMedia: true });
    const names = zip.names.join('\n');
    expect(names).not.toContain('Summer');
    expect(names).not.toContain('beach');
    await zip.close();
  });

  it('audits the new flags and the media count, never the password', async () => {
    const zip = await exportZip([mediaRow()], { includeMedia: true, includeVersions: true });
    const meta = zip.prisma.auditEvent.create.mock.calls[0][0].data.meta;
    expect(meta).toMatchObject({
      includeSecrets: true,
      includeAttachments: true,
      includeVersions: true,
      includeMedia: true,
      mediaFolderCount: 1,
      mediaFileCount: 1,
    });
    expect(JSON.stringify(zip.prisma.auditEvent.create.mock.calls)).not.toContain(PASSWORD);
    await zip.close();
  });
});
