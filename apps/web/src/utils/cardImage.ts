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
 * Generous on purpose. An earlier 1400px cap assumed pixels past that point
 * bought nothing, which proved false in practice: faint engraving (metal
 * cards) photographed without filling the frame came out too small to read
 * after crop + downscale. The provider downsizes internally anyway, so
 * sending more pixels just lets IT decide what to keep — the only real cost
 * is upload size, which the quality ladder below still bounds.
 */
export const CARD_IMAGE_MAX_LONG_EDGE = 2048;

/** Starting JPEG quality. The ladder below drops from here only if it must. */
export const CARD_IMAGE_JPEG_QUALITY = 0.9;

/** Upper bound of the user-adjustable crop zoom (1 = the auto-fit rect). */
export const CARD_IMAGE_MAX_ZOOM = 4;

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
const QUALITY_LADDER = [CARD_IMAGE_JPEG_QUALITY, 0.8, 0.7, 0.55, 0.4];

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
  /**
   * In EFFECTIVE source coordinates: the source frame after `quarterTurns`
   * clockwise quarter-turns have been applied. For odd turn counts the
   * effective width/height are the source's swapped.
   */
  crop: CropRect;
  output: OutputSize;
  /** Clockwise quarter-turns (0-3) the renderer must apply at draw time. */
  quarterTurns: number;
}

/**
 * User adjustments to the crop, all optional and all defaulting to the
 * auto-fit behavior (zoom 1, no pan, no rotation).
 */
export interface CardAdjustments {
  /** 1 = the auto-fit maximal rect; up to {@link CARD_IMAGE_MAX_ZOOM}. */
  zoom?: number;
  /** Pan offset from center, in effective source pixels. Clamped internally. */
  panX?: number;
  panY?: number;
  /** Clockwise quarter-turns, 0-3. */
  quarterTurns?: number;
}

export interface CardCropOptions extends CardAdjustments {
  aspectRatio?: number;
  maxLongEdge?: number;
}

/** Clamp `value` into `[min, max]`. Non-finite values clamp to `min`. */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Normalize any number (or undefined) of quarter-turns into 0..3. */
export function normalizeQuarterTurns(turns: number | undefined): number {
  if (turns === undefined || !Number.isFinite(turns)) return 0;
  return ((Math.round(turns) % 4) + 4) % 4;
}

/**
 * The source frame's dimensions AFTER rotation. An odd number of quarter-turns
 * swaps width and height; the crop rect is always computed against these
 * effective dimensions, never the raw ones.
 */
export function effectiveSourceSize(
  sourceWidth: number,
  sourceHeight: number,
  quarterTurns: number | undefined,
): { width: number; height: number } {
  assertPositiveDimensions(sourceWidth, sourceHeight);
  const odd = normalizeQuarterTurns(quarterTurns) % 2 === 1;
  return odd
    ? { width: sourceHeight, height: sourceWidth }
    : { width: sourceWidth, height: sourceHeight };
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
 * This is the STARTING point, not the final word: it is what the user sees at
 * zoom 1 before adjusting. The centred maximal rect is right often enough to
 * be a good default, but a card that does not fill the frame (or arrives
 * rotated) is fixed by the user via {@link computeAdjustedCropRect} rather
 * than by retaking the shot.
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
 * How far the crop rect can move from center, per axis, in effective source
 * pixels, at a given zoom. Zero on an axis the crop already fills.
 *
 * The UI uses this to clamp the STORED pan as the user drags or zooms out, so
 * pan offsets never silently accumulate past the edge of the frame.
 */
export function computeMaxPan(
  sourceWidth: number,
  sourceHeight: number,
  zoom: number,
  aspectRatio: number = CARD_ASPECT_RATIO,
): { x: number; y: number } {
  const base = computeCardCropRect(sourceWidth, sourceHeight, aspectRatio);
  const safeZoom = clamp(zoom, 1, CARD_IMAGE_MAX_ZOOM);
  const width = Math.max(1, Math.round(base.width / safeZoom));
  const height = Math.max(1, Math.round(base.height / safeZoom));
  return {
    x: Math.max(0, (sourceWidth - width) / 2),
    y: Math.max(0, (sourceHeight - height) / 2),
  };
}

/**
 * The user-adjusted crop rect: the auto-fit rect of
 * {@link computeCardCropRect}, shrunk by `zoom` and moved by `(panX, panY)`
 * from center.
 *
 * `zoom` is clamped into `[1, CARD_IMAGE_MAX_ZOOM]` and the rect is clamped so
 * it never leaves the source frame, whatever pan is passed in. With
 * `zoom = 1, panX = 0, panY = 0` this returns exactly the auto-fit rect.
 *
 * NOTE ON ROTATION: rotation is applied at draw time, not here. Callers
 * cropping a rotated source must pass the EFFECTIVE dimensions (see
 * {@link effectiveSourceSize}) — for odd quarter-turns width and height swap.
 */
export function computeAdjustedCropRect(
  sourceWidth: number,
  sourceHeight: number,
  zoom: number,
  panX: number,
  panY: number,
  aspectRatio: number = CARD_ASPECT_RATIO,
): CropRect {
  const base = computeCardCropRect(sourceWidth, sourceHeight, aspectRatio);
  const safeZoom = clamp(zoom, 1, CARD_IMAGE_MAX_ZOOM);
  const width = Math.max(1, Math.round(base.width / safeZoom));
  const height = Math.max(1, Math.round(base.height / safeZoom));
  const offsetX = Number.isFinite(panX) ? panX : 0;
  const offsetY = Number.isFinite(panY) ? panY : 0;

  return {
    x: clamp(
      Math.round((sourceWidth - width) / 2 + offsetX),
      0,
      sourceWidth - width,
    ),
    y: clamp(
      Math.round((sourceHeight - height) / 2 + offsetY),
      0,
      sourceHeight - height,
    ),
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

/**
 * Crop rect plus the size it will be encoded at.
 *
 * With no adjustments in `options` this plans exactly the auto-fit centred
 * crop it always has. With adjustments, the crop rect is computed against the
 * ROTATED (effective) frame; the returned `quarterTurns` tells the renderer
 * which rotation to apply at draw time so the rect lands where the user aimed.
 */
export function planCardCrop(
  sourceWidth: number,
  sourceHeight: number,
  options: CardCropOptions = {},
): CardCropPlan {
  const quarterTurns = normalizeQuarterTurns(options.quarterTurns);
  const effective = effectiveSourceSize(sourceWidth, sourceHeight, quarterTurns);
  const crop = computeAdjustedCropRect(
    effective.width,
    effective.height,
    options.zoom ?? 1,
    options.panX ?? 0,
    options.panY ?? 0,
    options.aspectRatio ?? CARD_ASPECT_RATIO,
  );
  const output = computeOutputSize(
    crop.width,
    crop.height,
    options.maxLongEdge ?? CARD_IMAGE_MAX_LONG_EDGE,
  );
  return { crop, output, quarterTurns };
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
 * Draw a planned card crop onto a destination rectangle, applying the plan's
 * rotation.
 *
 * Shared by the final encode in {@link cropImageFileToCard} and the live
 * preview in the adjust UI, so what the user sees while adjusting is drawn by
 * the same code as what gets encoded. `destWidth`/`destHeight` need not match
 * `plan.output` — the preview draws at screen resolution.
 *
 * The unrotated path is the exact `drawImage` source-rect call this module has
 * always made. The rotated paths compose translate/rotate so that a point
 * `(u, v)` of the raw source lands where the effective (rotated) frame puts
 * it, then shift/scale the crop rect onto the destination.
 */
export function drawCardCrop(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  plan: Pick<CardCropPlan, 'crop' | 'quarterTurns'>,
  destWidth: number,
  destHeight: number,
): void {
  const { crop } = plan;
  const turns = normalizeQuarterTurns(plan.quarterTurns);

  if (turns === 0) {
    context.drawImage(
      image,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      destWidth,
      destHeight,
    );
    return;
  }

  const effective = effectiveSourceSize(sourceWidth, sourceHeight, turns);

  context.save();
  // Innermost-to-outermost: rotate raw -> effective coords, shift the crop
  // origin to (0,0), scale the crop onto the destination.
  context.scale(destWidth / crop.width, destHeight / crop.height);
  context.translate(-crop.x, -crop.y);
  if (turns === 1) {
    context.translate(effective.width, 0);
  } else if (turns === 2) {
    context.translate(effective.width, effective.height);
  } else {
    context.translate(0, effective.height);
  }
  context.rotate((turns * Math.PI) / 2);
  context.drawImage(image, 0, 0, sourceWidth, sourceHeight);
  context.restore();
}

/**
 * Crop, downscale and JPEG-encode a captured file to the card rectangle.
 *
 * `options` may carry user adjustments (`zoom`, `panX`, `panY`,
 * `quarterTurns`); with none supplied the behavior is the historical auto-fit
 * centred crop, unchanged.
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

  const plan = planCardCrop(sourceWidth, sourceHeight, options);
  const { output } = plan;

  const canvas = document.createElement('canvas');
  canvas.width = output.width;
  canvas.height = output.height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('This browser could not process the image.');
  }

  drawCardCrop(
    context,
    image,
    sourceWidth,
    sourceHeight,
    plan,
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
