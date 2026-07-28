import { describe, expect, it } from 'vitest';

import {
  CARD_ASPECT_RATIO,
  CARD_IMAGE_JPEG_QUALITY,
  CARD_IMAGE_MAX_LONG_EDGE,
  CARD_IMAGE_MAX_ZOOM,
  clamp,
  computeAdjustedCropRect,
  computeCardCropRect,
  computeMaxPan,
  computeOutputSize,
  dataUrlToBlob,
  effectiveSourceSize,
  normalizeQuarterTurns,
  planCardCrop,
} from '../../utils/cardImage';

/**
 * Only the arithmetic is tested here. `cropImageFileToCard` is deliberately
 * absent: jsdom implements neither `HTMLCanvasElement.prototype.toBlob` nor
 * `toDataURL`, so any test of the encode step would assert on jsdom's "not
 * implemented" behaviour rather than on ours.
 */
describe('cardImage geometry', () => {
  describe('CARD_ASPECT_RATIO', () => {
    it('matches ISO/IEC 7810 ID-1 (85.60 x 53.98 mm)', () => {
      expect(CARD_ASPECT_RATIO).toBeCloseTo(1.5858, 3);
      expect(CARD_ASPECT_RATIO).toBe(85.6 / 53.98);
    });
  });

  describe('computeCardCropRect', () => {
    it('trims the sides of a source wider than a card', () => {
      // 2000x1000 is 2.0:1, wider than 1.586:1, so height binds.
      const rect = computeCardCropRect(2000, 1000);

      expect(rect.height).toBe(1000);
      expect(rect.y).toBe(0);
      expect(rect.width).toBe(Math.round(1000 * CARD_ASPECT_RATIO));
      // Centred: equal margin on both sides.
      expect(rect.x).toBe(Math.round((2000 - rect.width) / 2));
      expect(rect.x + rect.width).toBeLessThanOrEqual(2000);
    });

    it('trims the top and bottom of a portrait source', () => {
      // 1000x2000 is 0.5:1, far narrower than a card, so width binds.
      const rect = computeCardCropRect(1000, 2000);

      expect(rect.width).toBe(1000);
      expect(rect.x).toBe(0);
      expect(rect.height).toBe(Math.round(1000 / CARD_ASPECT_RATIO));
      expect(rect.y).toBe(Math.round((2000 - rect.height) / 2));
      expect(rect.y + rect.height).toBeLessThanOrEqual(2000);
    });

    it('keeps the whole frame when the source already has the card ratio', () => {
      const height = 540;
      const width = Math.round(height * CARD_ASPECT_RATIO); // 856

      const rect = computeCardCropRect(width, height);

      expect(rect).toEqual({ x: 0, y: 0, width, height });
    });

    it('produces the card ratio for both orientations', () => {
      for (const [w, h] of [
        [4032, 3024],
        [3024, 4032],
        [1920, 1080],
        [640, 640],
      ]) {
        const rect = computeCardCropRect(w, h);
        expect(rect.width / rect.height).toBeCloseTo(CARD_ASPECT_RATIO, 1);
      }
    });

    it('never returns a rect that hangs off the source frame', () => {
      for (const [w, h] of [
        [3, 2],
        [7, 5],
        [101, 99],
        [1, 1],
      ]) {
        const rect = computeCardCropRect(w, h);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(w);
        expect(rect.y + rect.height).toBeLessThanOrEqual(h);
      }
    });

    it('never returns a zero-dimension rect for a tiny source', () => {
      const rect = computeCardCropRect(1, 1);

      expect(rect.width).toBeGreaterThanOrEqual(1);
      expect(rect.height).toBeGreaterThanOrEqual(1);
    });

    it('honours a caller-supplied aspect ratio', () => {
      const rect = computeCardCropRect(1000, 1000, 2);

      expect(rect.width).toBe(1000);
      expect(rect.height).toBe(500);
      expect(rect.y).toBe(250);
    });

    it('rejects non-positive or non-finite dimensions', () => {
      expect(() => computeCardCropRect(0, 100)).toThrow(RangeError);
      expect(() => computeCardCropRect(100, -1)).toThrow(RangeError);
      expect(() => computeCardCropRect(Number.NaN, 100)).toThrow(RangeError);
      expect(() => computeCardCropRect(100, 100, 0)).toThrow(RangeError);
    });
  });

  describe('computeOutputSize', () => {
    it('scales the longest edge down to the cap', () => {
      const size = computeOutputSize(4000, 2522);

      expect(Math.max(size.width, size.height)).toBe(CARD_IMAGE_MAX_LONG_EDGE);
      expect(size.scale).toBeCloseTo(CARD_IMAGE_MAX_LONG_EDGE / 4000, 6);
    });

    it('scales against the height when the crop is portrait', () => {
      const size = computeOutputSize(1000, 3000, 1400);

      expect(size.height).toBe(1400);
      expect(size.width).toBe(467);
      expect(size.scale).toBeCloseTo(1400 / 3000, 6);
    });

    it('never upscales a small crop', () => {
      const size = computeOutputSize(600, 378);

      expect(size).toEqual({ width: 600, height: 378, scale: 1 });
    });

    it('preserves the aspect ratio through the downscale', () => {
      const size = computeOutputSize(3000, 1892);

      expect(size.width / size.height).toBeCloseTo(3000 / 1892, 2);
    });

    it('rejects a non-positive cap', () => {
      expect(() => computeOutputSize(100, 100, 0)).toThrow(RangeError);
    });

    it('caps the long edge at 2048px by default', () => {
      // Pinned to a literal, not just the constant, so a future accidental
      // change to CARD_IMAGE_MAX_LONG_EDGE fails a test rather than silently
      // changing behaviour (the 1400px cap this replaced made cards too small
      // to read after crop + downscale).
      expect(CARD_IMAGE_MAX_LONG_EDGE).toBe(2048);
      const size = computeOutputSize(6000, 4000);

      expect(Math.max(size.width, size.height)).toBe(2048);
    });
  });

  describe('CARD_IMAGE_JPEG_QUALITY', () => {
    it('starts the quality ladder at 0.9', () => {
      expect(CARD_IMAGE_JPEG_QUALITY).toBe(0.9);
    });
  });

  describe('clamp', () => {
    it('passes values already inside the range through unchanged', () => {
      expect(clamp(5, 0, 10)).toBe(5);
    });

    it('pins a value below the minimum to the minimum', () => {
      expect(clamp(-5, 0, 10)).toBe(0);
    });

    it('pins a value above the maximum to the maximum', () => {
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it('treats non-finite input as the minimum', () => {
      expect(clamp(Number.NaN, 2, 10)).toBe(2);
      expect(clamp(Number.POSITIVE_INFINITY, 2, 10)).toBe(2);
      expect(clamp(Number.NEGATIVE_INFINITY, 2, 10)).toBe(2);
    });
  });

  describe('normalizeQuarterTurns', () => {
    it('defaults an undefined input to 0', () => {
      expect(normalizeQuarterTurns(undefined)).toBe(0);
    });

    it('leaves an in-range turn count unchanged', () => {
      expect(normalizeQuarterTurns(0)).toBe(0);
      expect(normalizeQuarterTurns(1)).toBe(1);
      expect(normalizeQuarterTurns(2)).toBe(2);
      expect(normalizeQuarterTurns(3)).toBe(3);
    });

    it('wraps a count of 4 or more back into 0..3', () => {
      expect(normalizeQuarterTurns(4)).toBe(0);
      expect(normalizeQuarterTurns(5)).toBe(1);
      expect(normalizeQuarterTurns(9)).toBe(1);
    });

    it('wraps a negative count into 0..3', () => {
      expect(normalizeQuarterTurns(-1)).toBe(3);
      expect(normalizeQuarterTurns(-4)).toBe(0);
      expect(normalizeQuarterTurns(-5)).toBe(3);
    });

    it('rounds a fractional count before wrapping', () => {
      expect(normalizeQuarterTurns(1.4)).toBe(1);
      expect(normalizeQuarterTurns(1.6)).toBe(2);
    });

    it('treats a non-finite count as 0', () => {
      expect(normalizeQuarterTurns(Number.NaN)).toBe(0);
      expect(normalizeQuarterTurns(Number.POSITIVE_INFINITY)).toBe(0);
    });
  });

  describe('effectiveSourceSize', () => {
    it('keeps the source dimensions for 0 or 2 quarter-turns', () => {
      expect(effectiveSourceSize(2000, 1000, 0)).toEqual({ width: 2000, height: 1000 });
      expect(effectiveSourceSize(2000, 1000, 2)).toEqual({ width: 2000, height: 1000 });
    });

    it('swaps the source dimensions for 1 or 3 quarter-turns', () => {
      expect(effectiveSourceSize(2000, 1000, 1)).toEqual({ width: 1000, height: 2000 });
      expect(effectiveSourceSize(2000, 1000, 3)).toEqual({ width: 1000, height: 2000 });
    });

    it('normalizes an out-of-range turn count before deciding parity', () => {
      // 5 turns is 1 turn (odd) after wrapping, so dimensions still swap.
      expect(effectiveSourceSize(2000, 1000, 5)).toEqual({ width: 1000, height: 2000 });
    });

    it('defaults undefined turns to unswapped', () => {
      expect(effectiveSourceSize(2000, 1000, undefined)).toEqual({
        width: 2000,
        height: 1000,
      });
    });

    it('rejects non-positive or non-finite dimensions', () => {
      expect(() => effectiveSourceSize(0, 100, 0)).toThrow(RangeError);
      expect(() => effectiveSourceSize(100, -1, 0)).toThrow(RangeError);
    });
  });

  describe('computeMaxPan', () => {
    it('is zero on the axis the auto-fit crop already fills', () => {
      // 2000x1000 is wider than a card, so the crop fills the full height and
      // only has slack on x.
      const max = computeMaxPan(2000, 1000, 1);

      expect(max.y).toBe(0);
      expect(max.x).toBeGreaterThan(0);
    });

    it('grows on both axes as the user zooms out the crop rect', () => {
      const atZoom1 = computeMaxPan(2000, 1000, 1);
      const atZoom2 = computeMaxPan(2000, 1000, 2);

      expect(atZoom2.x).toBeGreaterThan(atZoom1.x);
      expect(atZoom2.y).toBeGreaterThan(atZoom1.y);
    });

    it('clamps zoom into [1, CARD_IMAGE_MAX_ZOOM] like the crop itself', () => {
      expect(computeMaxPan(2000, 1000, 0)).toEqual(computeMaxPan(2000, 1000, 1));
      expect(computeMaxPan(2000, 1000, 100)).toEqual(
        computeMaxPan(2000, 1000, CARD_IMAGE_MAX_ZOOM),
      );
    });

    it('never reports negative slack', () => {
      const max = computeMaxPan(2000, 1000, 1);

      expect(max.x).toBeGreaterThanOrEqual(0);
      expect(max.y).toBeGreaterThanOrEqual(0);
    });
  });

  describe('computeAdjustedCropRect', () => {
    it('reproduces the auto-fit rect exactly at zoom 1, no pan', () => {
      const rect = computeAdjustedCropRect(2000, 1000, 1, 0, 0);

      expect(rect).toEqual(computeCardCropRect(2000, 1000));
    });

    it('shrinks the rect proportionally around the centre as zoom increases', () => {
      const base = computeCardCropRect(2000, 1000);
      const zoomed = computeAdjustedCropRect(2000, 1000, 2, 0, 0);

      expect(zoomed.width).toBe(Math.round(base.width / 2));
      expect(zoomed.height).toBe(Math.round(base.height / 2));
      // Still centred in the source frame.
      expect(zoomed.x).toBe(Math.round((2000 - zoomed.width) / 2));
      expect(zoomed.y).toBe(Math.round((1000 - zoomed.height) / 2));
    });

    it('moves the rect by the requested pan', () => {
      const centred = computeAdjustedCropRect(2000, 1000, 2, 0, 0);
      const panned = computeAdjustedCropRect(2000, 1000, 2, 50, 0);

      expect(panned.x).toBe(centred.x + 50);
      expect(panned.y).toBe(centred.y);
    });

    it('clamps pan at the edge the source frame reports via computeMaxPan', () => {
      const max = computeMaxPan(2000, 1000, 2);
      const pinnedRight = computeAdjustedCropRect(2000, 1000, 2, max.x + 10_000, 0);
      const pinnedLeft = computeAdjustedCropRect(2000, 1000, 2, -(max.x + 10_000), 0);

      expect(pinnedRight.x + pinnedRight.width).toBe(2000);
      expect(pinnedLeft.x).toBe(0);
    });

    it('never returns a rect that hangs off the source frame at any zoom', () => {
      for (const zoom of [1, 1.5, 2, 4]) {
        const rect = computeAdjustedCropRect(2000, 1000, zoom, 0, 0);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(2000);
        expect(rect.y + rect.height).toBeLessThanOrEqual(1000);
      }
    });

    it('treats non-finite pan as zero rather than propagating NaN', () => {
      const rect = computeAdjustedCropRect(
        2000,
        1000,
        1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
      );

      expect(rect).toEqual(computeCardCropRect(2000, 1000));
    });
  });

  describe('planCardCrop', () => {
    it('crops to the card ratio and then downscales', () => {
      // A 4:3 phone capture is narrower than a card, so the width binds and the
      // top/bottom are trimmed.
      const plan = planCardCrop(4032, 3024);

      expect(plan.crop.width).toBe(4032);
      expect(plan.crop.height).toBe(Math.round(4032 / CARD_ASPECT_RATIO));
      expect(Math.max(plan.output.width, plan.output.height)).toBe(
        CARD_IMAGE_MAX_LONG_EDGE,
      );
      expect(plan.output.width / plan.output.height).toBeCloseTo(
        CARD_ASPECT_RATIO,
        1,
      );
    });

    it('leaves a small source at its original size', () => {
      const plan = planCardCrop(800, 800);

      expect(plan.output.scale).toBe(1);
      expect(plan.output.width).toBe(plan.crop.width);
      expect(plan.output.height).toBe(plan.crop.height);
    });

    it('defaults to quarterTurns 0 and reports it in the plan', () => {
      const plan = planCardCrop(4032, 3024);

      expect(plan.quarterTurns).toBe(0);
    });

    it('zoom 1 / pan 0 / turns 0 reproduces the legacy (no-options) plan exactly', () => {
      const legacy = planCardCrop(4032, 3024);
      const explicit = planCardCrop(4032, 3024, {
        zoom: 1,
        panX: 0,
        panY: 0,
        quarterTurns: 0,
      });

      expect(explicit).toEqual(legacy);
    });

    it('crops against the ROTATED frame and reports the turns to apply at draw time', () => {
      // 2000x1000 is landscape; rotated a quarter turn the effective frame is
      // 1000x2000 (portrait), so the crop is computed against THAT, not the
      // raw source.
      const plan = planCardCrop(2000, 1000, { quarterTurns: 1 });

      expect(plan.quarterTurns).toBe(1);
      expect(plan.crop.width / plan.crop.height).toBeCloseTo(CARD_ASPECT_RATIO, 1);
      expect(plan.crop.width).toBeLessThanOrEqual(1000);
      expect(plan.crop.height).toBeLessThanOrEqual(2000);
    });

    it('normalizes an out-of-range quarterTurns option', () => {
      expect(planCardCrop(2000, 1000, { quarterTurns: 5 }).quarterTurns).toBe(1);
      expect(planCardCrop(2000, 1000, { quarterTurns: -1 }).quarterTurns).toBe(3);
    });

    it('shrinks the crop as zoom increases, same as computeAdjustedCropRect', () => {
      const atZoom1 = planCardCrop(2000, 1000, { zoom: 1 });
      const atZoom2 = planCardCrop(2000, 1000, { zoom: 2 });

      expect(atZoom2.crop.width).toBeLessThan(atZoom1.crop.width);
      expect(atZoom2.crop.height).toBeLessThan(atZoom1.crop.height);
    });
  });

  describe('dataUrlToBlob', () => {
    it('decodes a base64 data URL to a blob of the right type and size', async () => {
      // "hello" -> aGVsbG8=
      const blob = dataUrlToBlob('data:image/jpeg;base64,aGVsbG8=');

      expect(blob.type).toBe('image/jpeg');
      expect(blob.size).toBe(5);
    });

    it('rejects anything that is not a base64 data URL', () => {
      expect(() => dataUrlToBlob('https://example.com/card.jpg')).toThrow();
      expect(() => dataUrlToBlob('data:image/jpeg,notbase64')).toThrow();
    });
  });
});
