import {
  attachmentFileName,
  extensionForMimeType,
  exportArchiveFileName,
  isAlreadyCompressed,
  isBrowserRenderableImage,
} from './attachment-file-name';

describe('extensionForMimeType', () => {
  it.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
    ['application/pdf', 'pdf'],
    ['image/svg+xml', 'svg'],
  ])('maps %s to %s', (mime, ext) => {
    expect(extensionForMimeType(mime)).toBe(ext);
  });

  it('ignores parameters and case', () => {
    expect(extensionForMimeType('Text/Plain; charset=UTF-8')).toBe('txt');
    expect(extensionForMimeType('  IMAGE/PNG ')).toBe('png');
  });

  it.each([[null], [undefined], [''], ['application/x-weird'], ['../../etc/passwd']])(
    'falls back to bin for %p',
    (mime) => {
      expect(extensionForMimeType(mime as string | null | undefined)).toBe('bin');
    },
  );
});

describe('attachmentFileName', () => {
  it('zero-pads to 4 and 2 digits', () => {
    expect(attachmentFileName(1, 1, 'image/jpeg')).toBe('attachments/0001-01.jpg');
    expect(attachmentFileName(12, 3, 'image/png')).toBe('attachments/0012-03.png');
  });

  it('keeps unique wider names beyond the padding width', () => {
    expect(attachmentFileName(10000, 100, 'application/pdf')).toBe(
      'attachments/10000-100.pdf',
    );
  });

  it('uses bin for unknown mime types', () => {
    expect(attachmentFileName(2, 2, 'x/y')).toBe('attachments/0002-02.bin');
  });

  it.each([[0, 1], [1, 0], [-1, 1], [1.5, 1], [1, NaN]])(
    'rejects non-positive-integer indexes (%p, %p)',
    (s, a) => {
      expect(() => attachmentFileName(s, a, 'image/png')).toThrow(RangeError);
    },
  );
});

describe('exportArchiveFileName', () => {
  it('formats the UTC date', () => {
    expect(exportArchiveFileName(new Date('2026-03-09T12:00:00Z'))).toBe(
      'vault-backup-2026-03-09.zip',
    );
  });

  it('uses UTC, not local time, around midnight', () => {
    expect(exportArchiveFileName(new Date('2026-12-31T23:59:59.999Z'))).toBe(
      'vault-backup-2026-12-31.zip',
    );
    expect(exportArchiveFileName(new Date('2027-01-01T00:00:00.000Z'))).toBe(
      'vault-backup-2027-01-01.zip',
    );
  });
});

describe('isBrowserRenderableImage / isAlreadyCompressed', () => {
  it('renders jpg/png/gif/webp but not heic or pdf', () => {
    expect(isBrowserRenderableImage('image/jpeg')).toBe(true);
    expect(isBrowserRenderableImage('image/webp')).toBe(true);
    expect(isBrowserRenderableImage('image/heic')).toBe(false);
    expect(isBrowserRenderableImage('application/pdf')).toBe(false);
    expect(isBrowserRenderableImage(null)).toBe(false);
  });

  it('treats images as compressed except svg/bmp/tiff', () => {
    expect(isAlreadyCompressed('image/jpeg')).toBe(true);
    expect(isAlreadyCompressed('application/zip')).toBe(true);
    expect(isAlreadyCompressed('image/svg+xml')).toBe(false);
    expect(isAlreadyCompressed('image/bmp')).toBe(false);
    expect(isAlreadyCompressed('text/plain')).toBe(false);
    expect(isAlreadyCompressed(undefined)).toBe(false);
  });
});
