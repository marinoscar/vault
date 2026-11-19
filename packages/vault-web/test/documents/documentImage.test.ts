// Issue #211: the crop maths at the passport (ID-3) ratio, used by the
// document scan through cardImage's `aspectRatio` parameter.
import { describe, expect, it } from 'vitest';
import { ID1_ASPECT_RATIO, ID3_ASPECT_RATIO } from '@marinoscar/vault-contract/secrets';

import {
  CARD_ASPECT_RATIO,
  computeAdjustedCropRect,
  cropRectFromBox,
  planCardCrop,
} from '../../src/cards/headless/cardImage.js';

describe('passport ratio (125/88)', () => {
  it('is the contract ratio and differs from the card one', () => {
    expect(ID3_ASPECT_RATIO).toBeCloseTo(125 / 88);
    expect(CARD_ASPECT_RATIO).toBeCloseTo(ID1_ASPECT_RATIO);
  });

  it('snaps a box to 125/88 in cropRectFromBox', () => {
    const rect = cropRectFromBox(2000, 1500, { x: 0.2, y: 0.2, width: 0.5, height: 0.5 }, ID3_ASPECT_RATIO, 0);
    expect(rect.width / rect.height).toBeCloseTo(125 / 88, 2);
    // The box centre is kept.
    expect(rect.x + rect.width / 2).toBeCloseTo(0.45 * 2000, -1);
    expect(rect.y + rect.height / 2).toBeCloseTo(0.45 * 1500, -1);
  });

  it('keeps the card ratio by default', () => {
    const rect = cropRectFromBox(2000, 1500, { x: 0.2, y: 0.2, width: 0.5, height: 0.5 }, undefined, 0);
    expect(rect.width / rect.height).toBeCloseTo(CARD_ASPECT_RATIO, 2);
  });

  it('auto-fits and plans at the passport ratio', () => {
    const fit = computeAdjustedCropRect(1600, 1200, 1, 0, 0, ID3_ASPECT_RATIO);
    expect(fit.width / fit.height).toBeCloseTo(125 / 88, 2);
    const plan = planCardCrop(1600, 1200, { aspectRatio: ID3_ASPECT_RATIO });
    expect(plan.output.width / plan.output.height).toBeCloseTo(125 / 88, 2);
  });
});
