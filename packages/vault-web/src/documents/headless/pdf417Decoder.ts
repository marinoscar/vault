// =============================================================================
// PDF417 decoder (issue #214). LOADED ON DEMAND ONLY: import it through
// `loadPdf417Decoder` of ./barcode.js (a dynamic import), never statically, so
// @zxing/library (Apache-2.0, pure JavaScript, no WebAssembly) stays out of
// the main bundle and runs under the app's `script-src 'self'` policy.
// =============================================================================

import { BinaryBitmap, DecodeHintType, HybridBinarizer, PDF417Reader, RGBLuminanceSource } from '@zxing/library';

/** Longest side the photo is decoded at: plenty for a PDF417 on a card, bounded in memory. */
const MAX_SIDE = 3000;

/** One decode attempt over a canvas; `null` when no PDF417 was found. */
function decodeCanvas(canvas: HTMLCanvasElement): string | null {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  const { width, height } = canvas;
  const rgba = context.getImageData(0, 0, width, height).data;
  const luminance = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < luminance.length; i += 1, p += 4) {
    luminance[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
  }
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminance, width, height)));
  const hints = new Map<DecodeHintType, unknown>([[DecodeHintType.TRY_HARDER, true]]);
  try {
    return new PDF417Reader().decode(bitmap, hints).getText();
  } catch {
    return null;
  }
}

/** Draws the image scaled to {@link MAX_SIDE}, turned a quarter clockwise when `rotate`. */
function draw(image: ImageBitmap, rotate: boolean): HTMLCanvasElement {
  const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = rotate ? h : w;
  canvas.height = rotate ? w : h;
  const context = canvas.getContext('2d');
  if (context) {
    if (rotate) {
      context.translate(h, 0);
      context.rotate(Math.PI / 2);
    }
    context.drawImage(image, 0, 0, w, h);
  }
  return canvas;
}

/**
 * The text of the PDF417 barcode in an image, upright or on its side (the
 * reader also handles upside down); `null` when none could be read. Throws only
 * when the image itself cannot be loaded (the caller turns that into `null`).
 *
 * @stability experimental
 */
export async function decodePdf417Image(file: Blob): Promise<string | null> {
  const image = await createImageBitmap(file);
  try {
    return decodeCanvas(draw(image, false)) ?? decodeCanvas(draw(image, true));
  } finally {
    image.close();
  }
}
