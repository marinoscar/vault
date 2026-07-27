import { describe, expect, it } from 'vitest';

import {
  CARD_ASPECT_RATIO,
  CARD_IMAGE_MAX_LONG_EDGE,
  computeCardCropRect,
  computeOutputSize,
  dataUrlToBlob,
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
