import {
  detectImageType,
  isDeclaredTypeConsistent,
  IMAGE_SIGNATURE_HEADER_BYTES,
} from './image-signature.util';

/** An `ftyp` box header carrying `brand` as its major brand. */
function isoBmff(brand: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x20]),
    Buffer.from('ftyp', 'latin1'),
    Buffer.from(brand, 'latin1'),
  ]);
}

/** Pad a signature out to a plausible file header length. */
function withBody(magic: Buffer, total = 64): Buffer {
  return Buffer.concat([magic, Buffer.alloc(Math.max(0, total - magic.length))]);
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'latin1'),
]);

describe('detectImageType', () => {
  describe('accepted formats', () => {
    it.each([
      ['JPEG (JFIF)', withBody(JPEG), 'image/jpeg'],
      ['JPEG (Exif, FF D8 FF E1)', withBody(Buffer.from([0xff, 0xd8, 0xff, 0xe1])), 'image/jpeg'],
      ['JPEG (raw SOS, FF D8 FF DB)', withBody(Buffer.from([0xff, 0xd8, 0xff, 0xdb])), 'image/jpeg'],
      ['PNG', withBody(PNG), 'image/png'],
      ['WebP', withBody(WEBP), 'image/webp'],
      ['HEIC (heic brand)', withBody(isoBmff('heic')), 'image/heic'],
      ['HEIC (heix brand)', withBody(isoBmff('heix')), 'image/heic'],
      ['HEIF (mif1 brand)', withBody(isoBmff('mif1')), 'image/heif'],
      ['HEIF (heif brand)', withBody(isoBmff('heif')), 'image/heif'],
    ])('detects %s', (_label, bytes, expected) => {
      expect(detectImageType(bytes)).toBe(expected);
    });

    it('decides on exactly the minimum header length', () => {
      expect(detectImageType(WEBP)).toBe('image/webp');
      expect(WEBP).toHaveLength(IMAGE_SIGNATURE_HEADER_BYTES);
    });

    it('is case-insensitive about the ISO-BMFF brand', () => {
      expect(detectImageType(withBody(isoBmff('HEIC')))).toBe('image/heic');
    });
  });

  describe('rejected content', () => {
    it.each([
      ['a PDF', Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3', 'latin1')],
      ['an HTML document', Buffer.from('<!DOCTYPE html><script>x</script>', 'latin1')],
      ['an SVG (an image, but a scriptable one)', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">', 'latin1')],
      ['a ZIP / OOXML', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0])],
      ['an ELF binary', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0, 0, 0, 0])],
      ['a GIF87a', Buffer.from('GIF87a\x00\x00\x00\x00\x00\x00', 'latin1')],
      ['a GIF89a', Buffer.from('GIF89a\x00\x00\x00\x00\x00\x00', 'latin1')],
      ['a BMP', Buffer.from('BM\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00', 'latin1')],
      ['a TIFF', Buffer.from([0x49, 0x49, 0x2a, 0x00, 0, 0, 0, 0, 0, 0, 0, 0])],
      ['plain text', Buffer.from('mock content', 'latin1')],
    ])('rejects %s', (_label, bytes) => {
      expect(detectImageType(bytes)).toBeNull();
    });

    it('rejects a PNG signature with mangled line endings', () => {
      // The trailing 0D 0A 1A 0A is the entire reason the PNG signature is 8
      // bytes: it catches transfers that rewrote CRLF. A check on `\x89PNG`
      // alone would pass this.
      const mangled = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0a, 0x1a, 0x0a, 0x00,
      ]);
      expect(detectImageType(withBody(mangled))).toBeNull();
    });

    it('rejects RIFF that is not WebP (e.g. a WAV)', () => {
      const wav = Buffer.concat([
        Buffer.from('RIFF', 'latin1'),
        Buffer.from([0x24, 0x00, 0x00, 0x00]),
        Buffer.from('WAVE', 'latin1'),
      ]);
      expect(detectImageType(withBody(wav))).toBeNull();
    });
  });

  describe('ISO-BMFF brands (the fiddly part)', () => {
    // `ftyp` at offset 4 is shared by the whole ISO base media family, so the
    // major brand at 8..12 is doing all of the work. Anything not on the
    // still-image list is rejected rather than guessed at.
    it.each([
      // Image SEQUENCES. Their MIME types are image/heic-sequence and
      // image/heif-sequence, which are not the types being claimed.
      ['hevc', 'an HEVC image sequence'],
      ['hevx', 'an HEVC image sequence'],
      ['msf1', 'a HEIF image sequence'],
      // Multiview / scalable HEVC: rare, and the mapping to one MIME type is
      // not clean.
      ['heim', 'multiview HEVC'],
      ['heis', 'scalable HEVC'],
      ['hevm', 'multiview HEVC sequence'],
      ['hevs', 'scalable HEVC sequence'],
      // A real still image, but image/avif is not on the card allowlist.
      ['avif', 'AVIF'],
      ['avis', 'an AVIF sequence'],
      // Video and other containers that would sail through a naive
      // "has ftyp -> it's a HEIC" check.
      ['isom', 'generic MP4'],
      ['mp41', 'MP4 v1'],
      ['mp42', 'MP4 v2'],
      ['avc1', 'H.264 in MP4'],
      ['qt  ', 'QuickTime'],
      ['M4V ', 'iTunes video'],
      ['crx ', 'Canon raw'],
      ['3gp4', '3GPP'],
    ])('rejects the major brand %s (%s)', (brand) => {
      expect(detectImageType(withBody(isoBmff(brand)))).toBeNull();
    });

    it('ignores the compatible-brand list', () => {
      // An MP4 that lists `heic` among its compatible brands is still an MP4.
      // Only the major brand counts — every byte here is attacker-controlled,
      // so reading further into the brand list could only ever widen what is
      // accepted.
      const mp4ClaimingHeic = Buffer.concat([
        isoBmff('mp42'),
        Buffer.from('isomheic', 'latin1'),
      ]);
      expect(detectImageType(mp4ClaimingHeic)).toBeNull();
    });
  });

  describe('short and malformed input', () => {
    it.each([
      ['an empty buffer', Buffer.alloc(0)],
      ['2 bytes of a JPEG signature', Buffer.from([0xff, 0xd8])],
      ['7 bytes of a PNG signature', PNG.subarray(0, 7)],
      ['11 bytes of a WebP signature', WEBP.subarray(0, 11)],
      ['an ftyp box cut off before the brand', isoBmff('heic').subarray(0, 8)],
      ['a 3-byte brand', isoBmff('hei')],
    ])('returns null for %s', (_label, bytes) => {
      expect(detectImageType(bytes)).toBeNull();
    });

    it('returns null for a non-buffer', () => {
      expect(detectImageType(undefined as unknown as Buffer)).toBeNull();
      expect(detectImageType(null as unknown as Buffer)).toBeNull();
    });

    it('still detects JPEG from its 3-byte minimum', () => {
      // JPEG and PNG decide before the 12-byte mark, which is why the contract
      // is "at least IMAGE_SIGNATURE_HEADER_BYTES, or fewer only if the stream
      // ended" rather than "exactly 12".
      expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
      expect(detectImageType(PNG)).toBe('image/png');
    });
  });
});

describe('isDeclaredTypeConsistent', () => {
  it.each([
    ['image/jpeg', 'image/jpeg'],
    ['image/png', 'image/png'],
    ['image/webp', 'image/webp'],
    ['image/heic', 'image/heic'],
    ['image/heif', 'image/heif'],
  ] as const)('accepts %s declared as %s', (detected, declared) => {
    expect(isDeclaredTypeConsistent(detected, declared)).toBe(true);
  });

  it('treats heic and heif as one family in both directions', () => {
    // An iPhone photo announced as image/heic very often carries a `mif1` major
    // brand, which resolves to image/heif. Both are on the allowlist, so an
    // exact-match rule would reject real photos for no security gain.
    expect(isDeclaredTypeConsistent('image/heif', 'image/heic')).toBe(true);
    expect(isDeclaredTypeConsistent('image/heic', 'image/heif')).toBe(true);
  });

  it.each([
    ['image/jpeg', 'image/png'],
    ['image/png', 'image/jpeg'],
    ['image/webp', 'image/jpeg'],
    ['image/jpeg', 'image/heic'],
    ['image/heic', 'image/png'],
    ['image/png', 'application/pdf'],
    ['image/jpeg', ''],
  ] as const)(
    'rejects %s declared as %s — unrelated formats get no latitude',
    (detected, declared) => {
      expect(isDeclaredTypeConsistent(detected, declared)).toBe(false);
    },
  );
});
