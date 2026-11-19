// =============================================================================
// Crop boxes shared by every scan profile (issue #204, IDOC-1)
// =============================================================================
// Moved from `card-extraction.schema.ts`: a document-locating box is the same
// shape whatever the document is, so every profile repairs it the same way.

/**
 * Where the model found the document inside one image, exactly as that image
 * was sent. Used client-side to produce the cropped attachment the user stores.
 *
 * `x`/`y`/`width`/`height` are FRACTIONS (0-1) of the image's width/height.
 * `quarterTurns` is 0-3: the number of 90-degree CLOCKWISE rotations to apply
 * to the cropped rectangle so the document reads upright. `confidence` is 0-1.
 *
 * @stability experimental
 */
export interface ScanCropBox {
  x: number;
  y: number;
  width: number;
  height: number;
  quarterTurns: number;
  confidence: number;
}

/** A box as a model returns it (snake_case, unclamped). */
export interface ModelCropBox {
  x: number;
  y: number;
  width: number;
  height: number;
  quarter_turns: number;
  confidence: number;
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/**
 * A document-locating box, repaired: coordinates clamped into [0,1], width/height
 * into [0.05,1], quarter turns wrapped into 0-3. Not-a-number degrades the
 * field to a harmless default. A bad box never costs the user their field data.
 */
export function repairBox(box: ModelCropBox | null | undefined): ScanCropBox | null {
  if (!box) return null;
  return {
    x: clamp01(box.x),
    y: clamp01(box.y),
    width: Number.isFinite(box.width) ? Math.min(1, Math.max(0.05, box.width)) : 1,
    height: Number.isFinite(box.height) ? Math.min(1, Math.max(0.05, box.height)) : 1,
    quarterTurns: Number.isFinite(box.quarter_turns)
      ? ((Math.round(box.quarter_turns) % 4) + 4) % 4
      : 0,
    confidence: clamp01(box.confidence),
  };
}
