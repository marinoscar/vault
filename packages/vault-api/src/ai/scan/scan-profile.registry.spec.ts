import { z } from 'zod';

import { CARD_EXTRACT_FEATURE } from '../ai.constants';
import { CARD_SCAN_PROFILE_ID } from '../card-scan.profile';
import type { ScanProfile } from './scan-profile';
import { createScanProfileRegistry, ScanProfileRegistry } from './scan-profile.registry';

function profile(id: string): ScanProfile<{ value: string }, string> {
  return {
    id,
    aiFeature: `${id}_extract`,
    imageSlots: [{ key: 'page', required: true, label: 'Page' }],
    schemaName: `${id}_extraction`,
    systemPrompt: 'Read the page.',
    modelSchema: z.object({ value: z.string() }),
    userText: () => 'Image 1 is the page.',
    toRaw: (output) => output.value,
    normalize: (raw) => String(raw),
    timeoutMs: 1_000,
  };
}

describe('ScanProfileRegistry', () => {
  it('registers, gets and lists profiles in registration order', () => {
    const registry = new ScanProfileRegistry();
    const a = profile('doc_a');
    const b = profile('doc_b');
    registry.register(a);
    registry.register(b);

    expect(registry.get('doc_a')).toBe(a);
    expect(registry.get('doc_b')).toBe(b);
    expect(registry.list().map((p) => p.id)).toEqual(['doc_a', 'doc_b']);
  });

  it('throws when the same id is registered twice', () => {
    const registry = new ScanProfileRegistry();
    registry.register(profile('doc_a'));
    expect(() => registry.register(profile('doc_a'))).toThrow(/already registered/);
    expect(registry.list()).toHaveLength(1);
  });

  it('throws on an unknown id', () => {
    expect(() => new ScanProfileRegistry().get('nope')).toThrow(/Unknown scan profile "nope"/);
  });

  it('the built-in registry holds the card profile under the card_extract feature', () => {
    const registry = createScanProfileRegistry();
    // The passport and ID document profiles (#210) follow the card.
    expect(registry.list().map((p) => p.id)).toEqual([CARD_SCAN_PROFILE_ID, 'passport', 'id_document']);
    const card = registry.get(CARD_SCAN_PROFILE_ID);
    expect(card.aiFeature).toBe(CARD_EXTRACT_FEATURE);
    expect(card.imageSlots.map((s) => [s.key, s.required])).toEqual([
      ['front', true],
      ['back', false],
    ]);
    expect(card.timeoutMs).toBe(90_000);
  });
});
