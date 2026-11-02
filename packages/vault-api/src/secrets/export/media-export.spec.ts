import {
  buildMediaPlan,
  ExportMediaFolderRow,
  mediaExtensionForMimeType,
  mediaFilePath,
  mediaFolderPath,
  skipPlannedMediaFile,
} from './media-export';

const OWNER = 'user-owner';
const OTHER = 'user-other';

const file = (id: string, folderId: string, over: Partial<{ status: string; mimeType: string; name: string }> = {}) => ({
  id,
  name: over.name ?? `${id}-holiday.mp4`,
  size: 10n,
  mimeType: over.mimeType ?? 'video/mp4',
  storageKey: `key/${id}`,
  status: over.status ?? 'ready',
  mediaFolderId: folderId,
  createdAt: new Date('2026-02-01T00:00:00Z'),
});

const folder = (id: string, userId: string, files: ReturnType<typeof file>[]): ExportMediaFolderRow => ({
  id,
  name: `Folder ${id}`,
  userId,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  files,
});

describe('media paths', () => {
  it('builds opaque, padded paths', () => {
    expect(mediaFolderPath(1)).toBe('media/0001');
    expect(mediaFilePath(2, 3, 'video/mp4')).toBe('media/0002/0003.mp4');
    expect(mediaFilePath(1, 1, 'image/jpeg')).toBe('media/0001/0001.jpg');
    expect(mediaFilePath(1, 1, 'application/x-unknown')).toBe('media/0001/0001.bin');
  });

  it('maps video and audio types', () => {
    expect(mediaExtensionForMimeType('video/quicktime')).toBe('mov');
    expect(mediaExtensionForMimeType('Audio/MPEG; foo=bar')).toBe('mp3');
    expect(mediaExtensionForMimeType(undefined)).toBe('bin');
  });

  it('rejects non-positive indexes', () => {
    expect(() => mediaFolderPath(0)).toThrow(RangeError);
    expect(() => mediaFilePath(1, 0, 'video/mp4')).toThrow(RangeError);
  });
});

describe('buildMediaPlan', () => {
  it('numbers folders and files positionally and keeps names out of paths', () => {
    const plan = buildMediaPlan(
      [folder('f1', OWNER, [file('a', 'f1'), file('b', 'f1', { mimeType: 'image/png' })]), folder('f2', OWNER, [])],
      OWNER,
    );
    expect(plan.manifest.folders.map((f) => f.folder)).toEqual(['media/0001', 'media/0002']);
    expect(plan.files.map((f) => f.path)).toEqual(['media/0001/0001.mp4', 'media/0001/0002.png']);
    expect(plan.manifest.folders[0]).toMatchObject({
      name: 'Folder f1',
      createdAt: '2026-01-01T00:00:00.000Z',
      files: [
        { file: 'media/0001/0001.mp4', originalName: 'a-holiday.mp4', mimeType: 'video/mp4', size: 10 },
        { file: 'media/0001/0002.png', originalName: 'b-holiday.mp4', mimeType: 'image/png', size: 10 },
      ],
    });
    expect(plan.manifest.folders[1].files).toEqual([]);
    for (const path of plan.files.map((f) => f.path)) {
      expect(path).not.toMatch(/holiday|Folder/);
    }
  });

  it("never includes another user's folder, even if one is handed in", () => {
    const plan = buildMediaPlan(
      [folder('mine', OWNER, [file('m1', 'mine')]), folder('theirs', OTHER, [file('t1', 'theirs')])],
      OWNER,
    );
    expect(plan.manifest.folders.map((f) => f.name)).toEqual(['Folder mine']);
    expect(plan.files.map((f) => f.storageObjectId)).toEqual(['m1']);
    expect(JSON.stringify(plan)).not.toContain('t1');
  });

  it('drops a file filed in a different folder than the one it is listed under', () => {
    const plan = buildMediaPlan([folder('mine', OWNER, [file('x', 'someone-elses-folder')])], OWNER);
    expect(plan.files).toEqual([]);
    expect(plan.manifest.folders[0].files).toEqual([]);
  });

  it('includes only completed uploads', () => {
    const plan = buildMediaPlan(
      [
        folder('f', OWNER, [
          file('ok', 'f'),
          file('pending', 'f', { status: 'pending' }),
          file('failed', 'f', { status: 'failed' }),
          file('processing', 'f', { status: 'processing' }),
        ]),
      ],
      OWNER,
    );
    expect(plan.files.map((f) => f.storageObjectId)).toEqual(['ok']);
  });

  it('skipPlannedMediaFile nulls the entry and adds a warning', () => {
    const plan = buildMediaPlan([folder('f', OWNER, [file('a', 'f')])], OWNER);
    skipPlannedMediaFile(plan, plan.files[0]);
    expect(plan.files).toEqual([]);
    expect(plan.manifest.folders[0].files[0].file).toBeNull();
    expect(plan.manifest.warnings).toEqual([
      'The media file "a-holiday.mp4" in the folder "Folder f" could not be read from storage and was not included.',
    ]);
  });
});
