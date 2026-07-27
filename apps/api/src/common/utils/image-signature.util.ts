// =============================================================================
// Image Signature Detection (magic numbers)
// =============================================================================
// Determines what a byte stream ACTUALLY is, independent of whatever
// `Content-Type` the client declared at upload time.
//
// Why this exists: every MIME type in this application is currently taken
// verbatim from the client's declared `Content-Type` header. A client that says
// `image/jpeg` while uploading a PDF, an HTML document, or a shell script is
// believed. This module is the ground truth that lets a caller disagree.
//
// Scope note: this is a *format* check, not a *safety* check. A file whose
// first bytes are a valid PNG signature is a PNG as far as any parser is
// concerned, but that says nothing about whether the rest of the file is
// well-formed or whether a decoder will survive it. Detecting the container is
// the part that stops the "declared image/jpeg, actually text/html" class of
// attack; it is not a substitute for a sandboxed decoder.

/**
 * The image types this detector can recognise.
 *
 * Intentionally narrow: it covers exactly the card-face allowlist
 * (`CARD_IMAGE_MIME_TYPES` in the secrets service). Anything else — GIF, AVIF,
 * TIFF, BMP, SVG — returns `null`, because "recognised" here means "recognised
 * AND on the accepted list". A detector that reported `image/gif` would invite
 * a caller to accept it.
 */
export type DetectedImageType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/heic'
  | 'image/heif';

/**
 * Bytes required before {@link detectImageType} can return a verdict.
 *
 * 12 is set by the two container formats that need the most context:
 *   - WebP: `RIFF` at 0..4, a 4-byte length, then `WEBP` at 8..12
 *   - HEIF: a 4-byte box length, `ftyp` at 4..8, then the major brand at 8..12
 *
 * JPEG (3 bytes) and PNG (8 bytes) decide sooner, but a caller that reads fewer
 * than this cannot distinguish "not enough bytes yet" from "not an image", so
 * the contract is: hand over at least this many bytes, or fewer only if the
 * stream genuinely ended first.
 */
export const IMAGE_SIGNATURE_HEADER_BYTES = 12;

/** `FF D8 FF` — SOI marker followed by the first marker's 0xFF prefix. */
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

/** `89 50 4E 47 0D 0A 1A 0A` — the full 8-byte PNG signature. */
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * ISO-BMFF major brands accepted as a still image, keyed to the MIME type they
 * map to.
 *
 * Read this list carefully before extending it — the `ftyp` box is shared by
 * the entire ISO base media family, so MP4 video, QuickTime movies, AVIF, and
 * Canon raw files all have `ftyp` at offset 4. Treating "has ftyp" as "is a
 * HEIC" would accept an arbitrary MP4. The brand at 8..12 is what actually
 * distinguishes them, and only these four are accepted:
 *
 *   heic - ISO/IEC 23008-12 HEVC still image. What an iPhone camera writes.
 *   heix - the same, at a different HEVC profile/bit depth. Same MIME type.
 *   mif1 - the generic HEIF still-image brand (codec-agnostic). Common as the
 *          major brand on Apple and Android HEIF writers that list `heic` only
 *          among the compatible brands.
 *   heif - not an ISO-registered brand, but written by some encoders. Its
 *          intent is unambiguous (a still image), and it maps to image/heif.
 *
 * Deliberately NOT accepted, and why:
 *
 *   hevc, hevx - HEVC image *sequences*. Their MIME type is
 *                `image/heic-sequence`, which is a different type from
 *                `image/heic` and is not on the card allowlist. A sequence is
 *                a multi-frame animation, not a card face.
 *   msf1       - the HEIF image *sequence* brand, `image/heif-sequence`. Same
 *                reasoning.
 *   heim, heis, hevm, hevs - multiview and scalable HEVC brands. Some of these
 *                designate sequences, the mapping to a single MIME type is not
 *                clean, and no phone camera produces them for a photo. Rejected
 *                rather than guessed at.
 *   avif, avis - genuinely still images, but `image/avif` is not on the card
 *                allowlist. Accepting them here would widen that allowlist
 *                through the back door instead of by an explicit decision.
 *   isom, mp41, mp42, avc1, qt, crx, and every other brand - not still images.
 *
 * Only the MAJOR brand is inspected; the compatible-brand list that follows it
 * is ignored. That is the strict reading, and it is the right one here: the
 * bytes are entirely attacker-controlled, so scanning further into the brand
 * list only ever widens what is accepted, never narrows it.
 */
const ISO_BMFF_STILL_IMAGE_BRANDS: Readonly<Record<string, DetectedImageType>> =
  {
    heic: 'image/heic',
    heix: 'image/heic',
    mif1: 'image/heif',
    heif: 'image/heif',
  };

/**
 * Identify the image format of a buffer from its leading bytes.
 *
 * @param header the first bytes of the file. Pass at least
 *   {@link IMAGE_SIGNATURE_HEADER_BYTES}; a shorter buffer is answered on the
 *   evidence available, which for the container formats means `null`.
 * @returns the detected type, or `null` when the bytes are not a recognised —
 *   meaning accepted — image format. `null` is also the answer for an empty or
 *   truncated header: callers must treat "cannot tell" as "reject", never as
 *   "probably fine".
 */
export function detectImageType(header: Buffer): DetectedImageType | null {
  if (!Buffer.isBuffer(header) || header.length === 0) {
    return null;
  }

  // JPEG — 3 bytes. Checked first because it is the common case.
  if (header.length >= 3 && header.subarray(0, 3).equals(JPEG_SIGNATURE)) {
    return 'image/jpeg';
  }

  // PNG — 8 bytes. The trailing `0D 0A 1A 0A` is the point of the signature:
  // it detects transfers that mangled line endings, so a partial match on the
  // leading `\x89PNG` alone is not good enough.
  if (header.length >= 8 && header.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'image/png';
  }

  // Everything below needs the full 12 bytes.
  if (header.length < IMAGE_SIGNATURE_HEADER_BYTES) {
    return null;
  }

  // WebP — a RIFF container whose form type is `WEBP`. Bytes 4..8 are the
  // little-endian chunk size and carry no signature value, so they are skipped.
  if (
    header.subarray(0, 4).toString('latin1') === 'RIFF' &&
    header.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }

  // HEIC/HEIF — an ISO base media file whose major brand is a still-image
  // brand. Bytes 0..4 are the `ftyp` box length and are not checked: a
  // conforming file has a length of at least 16 there, but the value is not a
  // signature and enforcing it would reject nothing an attacker could not
  // trivially fix.
  if (header.subarray(4, 8).toString('latin1') === 'ftyp') {
    const majorBrand = header.subarray(8, 12).toString('latin1').toLowerCase();
    return ISO_BMFF_STILL_IMAGE_BRANDS[majorBrand] ?? null;
  }

  return null;
}

/**
 * Whether a detected type may be served under a declared type.
 *
 * Exact equality, with ONE deliberate exception: `image/heic` and `image/heif`
 * are treated as interchangeable. They are the same container (ISO-BMFF) and
 * both sit on the card allowlist, but which of the two a given file's major
 * brand resolves to is an encoder detail — an iPhone photo saved as `.heic` and
 * announced by the browser as `image/heic` very often carries a `mif1` major
 * brand, which resolves to `image/heif`. Demanding an exact match there would
 * reject real iPhone photos to buy no security at all, since both outcomes are
 * already accepted types.
 *
 * No such latitude is extended to JPEG, PNG, or WebP: those are unrelated
 * formats and a mismatch is a genuine contradiction.
 */
export function isDeclaredTypeConsistent(
  detected: DetectedImageType,
  declared: string,
): boolean {
  if (detected === declared) {
    return true;
  }

  const heifFamily = new Set<string>(['image/heic', 'image/heif']);
  return heifFamily.has(detected) && heifFamily.has(declared);
}
