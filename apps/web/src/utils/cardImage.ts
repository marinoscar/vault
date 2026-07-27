// =============================================================================
// Card image cropping
// =============================================================================
// The crop happens in the BROWSER, before anything is sent anywhere. The
// extraction endpoint receives an already-cropped image, so whatever else was
// in the camera frame — the desk, the rest of the wallet, the room — never
// leaves the device. That property only holds if callers use
// `cropImageFileToCard` rather than uploading the raw capture.
//
// Everything above the "Canvas shim" divider is pure arithmetic and is unit
// tested. Everything below it touches `document`/`Image`/`canvas` and is NOT
// tested: jsdom implements neither `HTMLCanvasElement.prototype.toBlob` nor
// `toDataURL`, so a test of the encode step would only ever assert that jsdom
// throws. The split is deliberate — keep new logic above the divider.

/**
 * ISO/IEC 7810 ID-1, the physical format every payment card uses:
 * 85.60 mm x 53.98 mm, i.e. ~1.586:1.
 *
 * Locking the crop to this ratio is what lets the user frame a shot roughly and
 * still hand the model a rectangle whose proportions match a real card.
 */
export const CARD_ASPECT_RATIO = 85.6 / 53.98;

/**
 * Longest edge of the encoded image.
 *
 * Embossed digits are legible well below the sensor resolution of any modern
 * phone, and every pixel past this point costs upload time and provider tokens
 * without improving the read.
 */
export const CARD_IMAGE_MAX_LONG_EDGE = 1400;

/** Starting JPEG quality. The ladder below drops from here only if it must. */
export const CARD_IMAGE_JPEG_QUALITY = 0.85;

export const CARD_IMAGE_MIME_TYPE = 'image/jpeg';

/**
 * Largest data URL the API accepts, mirroring `MAX_IMAGE_DATA_URL_LENGTH` in
 * `apps/api/src/ai/ai.constants.ts`. Measured in characters, not bytes, because
 * that is what the server-side `.max()` checks.
 */
export const MAX_IMAGE_DATA_URL_LENGTH = 2_800_000;

/**
 * Quality steps tried in order until the encoded data URL fits the cap.
 *
 * Re-encoding at lower quality is preferred over shrinking further: a
 * card number survives JPEG artefacts far better than it survives losing
 * pixels.
 */
const QUALITY_LADDER = [CARD_IMAGE_JPEG_QUALITY, 0.7, 0.55, 0.4];

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OutputSize {
  width: number;
  height: number;
  /** Factor applied to the crop rect to reach the output size; never above 1. */
  scale: number;
}

export interface CardCropPlan {
  crop: CropRect;
  output: OutputSize;
}

export interface CardCropOptions {
  aspectRatio?: number;
  maxLongEdge?: number;
}

function assertPositiveDimensions(width: number, height: number): void {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new RangeError(
      `Image dimensions must be positive finite numbers; received ${width}x${height}`,
    );
  }
}

/**
 * The largest rectangle of `aspectRatio` that fits inside the source frame,
 * centred.
 *
 * Auto-fitting rather than asking the user to drag a box is a deliberate
 * trade: a card photographed at arm's length fills most of the frame, and a
 * centred maximal rect gets it right often enough that a drag handle would cost
 * more taps than it saves. The review step is where a bad crop gets corrected —
 * by retaking the shot.
 *
 * Results are integers because they index pixels. Every value is clamped into
 * the source frame so a rounding step can never produce a rect that hangs off
 * the edge, and never a zero-width rect for a source only a few pixels across.
 */
export function computeCardCropRect(
  sourceWidth: number,
  sourceHeight: number,
  aspectRatio: number = CARD_ASPECT_RATIO,
): CropRect {
  assertPositiveDimensions(sourceWidth, sourceHeight);
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    throw new RangeError(`Aspect ratio must be positive; received ${aspectRatio}`);
  }

  // Source wider than a card -> the card's height is the binding constraint,
  // and we trim the sides. Otherwise the width binds and we trim top/bottom.
  const sourceIsWider = sourceWidth / sourceHeight > aspectRatio;
  const exactWidth = sourceIsWider ? sourceHeight * aspectRatio : sourceWidth;
  const exactHeight = sourceIsWider ? sourceHeight : sourceWidth / aspectRatio;

  const width = Math.max(1, Math.min(sourceWidth, Math.round(exactWidth)));
  const height = Math.max(1, Math.min(sourceHeight, Math.round(exactHeight)));

  return {
    x: Math.max(0, Math.round((sourceWidth - width) / 2)),
    y: Math.max(0, Math.round((sourceHeight - height) / 2)),
    width,
    height,
  };
}

/**
 * Downscale the crop so its longest edge is at most `maxLongEdge`.
 *
 * Never upscales: a low-resolution capture stays low-resolution rather than
 * being inflated into a bigger file that carries no extra detail.
 */
export function computeOutputSize(
  cropWidth: number,
  cropHeight: number,
  maxLongEdge: number = CARD_IMAGE_MAX_LONG_EDGE,
): OutputSize {
  assertPositiveDimensions(cropWidth, cropHeight);
  if (!Number.isFinite(maxLongEdge) || maxLongEdge <= 0) {
    throw new RangeError(`Max long edge must be positive; received ${maxLongEdge}`);
  }

  const longEdge = Math.max(cropWidth, cropHeight);
  const scale = Math.min(1, maxLongEdge / longEdge);

  return {
    width: Math.max(1, Math.round(cropWidth * scale)),
    height: Math.max(1, Math.round(cropHeight * scale)),
    scale,
  };
}

/** Crop rect plus the size it will be encoded at. */
export function planCardCrop(
  sourceWidth: number,
  sourceHeight: number,
  options: CardCropOptions = {},
): CardCropPlan {
  const crop = computeCardCropRect(
    sourceWidth,
    sourceHeight,
    options.aspectRatio ?? CARD_ASPECT_RATIO,
  );
  const output = computeOutputSize(
    crop.width,
    crop.height,
    options.maxLongEdge ?? CARD_IMAGE_MAX_LONG_EDGE,
  );
  return { crop, output };
}

/**
 * Decode a base64 data URL into a Blob.
 *
 * Used instead of `canvas.toBlob` so the canvas is encoded exactly once: the
 * same bytes become both the JSON payload for the extraction call and the file
 * uploaded to storage, which is the only way the stored image is guaranteed to
 * be the image the model actually read.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) {
    throw new Error('Expected a base64 data URL');
  }

  const [, mimeType, base64] = match;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

// -----------------------------------------------------------------------------
// Canvas shim (not unit tested — see the file header)
// -----------------------------------------------------------------------------

export interface CroppedCardImage {
  /** JPEG data URL, ready for `POST /api/secrets/cards/extract`. */
  dataUrl: string;
  /** The same bytes as a File, ready for the storage upload endpoint. */
  file: File;
  /** Object URL for on-screen preview. Callers must revoke it when done. */
  previewUrl: string;
  width: number;
  height: number;
}

async function loadImageElement(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () =>
        reject(new Error('That file could not be read as an image.'));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Crop, downscale and JPEG-encode a captured file to the card rectangle.
 *
 * Throws with a user-presentable message when the file is not decodable or
 * cannot be squeezed under the API's size cap.
 */
export async function cropImageFileToCard(
  file: File,
  options: CardCropOptions & { fileName?: string } = {},
): Promise<CroppedCardImage> {
  const image = await loadImageElement(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;

  if (!sourceWidth || !sourceHeight) {
    throw new Error('That image appears to be empty.');
  }

  const { crop, output } = planCardCrop(sourceWidth, sourceHeight, options);

  const canvas = document.createElement('canvas');
  canvas.width = output.width;
  canvas.height = output.height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('This browser could not process the image.');
  }

  context.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    output.width,
    output.height,
  );

  let dataUrl = '';
  for (const quality of QUALITY_LADDER) {
    dataUrl = canvas.toDataURL(CARD_IMAGE_MIME_TYPE, quality);
    if (dataUrl.length <= MAX_IMAGE_DATA_URL_LENGTH) break;
  }

  if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
    throw new Error(
      'That photo is too large to process even after compression. Try a photo taken at a lower resolution.',
    );
  }

  const blob = dataUrlToBlob(dataUrl);
  const fileName = options.fileName ?? 'card.jpg';

  return {
    dataUrl,
    file: new File([blob], fileName, { type: CARD_IMAGE_MIME_TYPE }),
    previewUrl: URL.createObjectURL(blob),
    width: output.width,
    height: output.height,
  };
}
