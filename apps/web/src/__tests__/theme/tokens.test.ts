import { describe, expect, it } from 'vitest';

import { BRAND_TOKENS, vaultDarkTheme, vaultLightTheme } from '../../theme';
import { contrastRatio } from '../../theme/contrast';

const L = BRAND_TOKENS.light;
const D = BRAND_TOKENS.dark;

/**
 * docs/specs/ux-refresh.md §5, recomputed from the tokens: [label, fg, bg, minimum, expected ratio].
 * 4.5 is WCAG AA for text, 3.0 for adjacent non-text fills.
 */
const PAIRS: [string, string, string, number, number][] = [
  ['light primary on paper', L.primary, L.paper, 4.5, 7.37],
  ['light primary on background', L.primary, L.background, 4.5, 6.86],
  ['light white on primary', L.onPrimary, L.primary, 4.5, 7.37],
  ['light text.primary on background', L.textPrimary, L.background, 4.5, 13.61],
  ['light text.primary on paper', L.textPrimary, L.paper, 4.5, 14.63],
  ['light text.secondary on paper', L.textSecondary, L.paper, 4.5, 7.58],
  ['light text.secondary on background', L.textSecondary, L.background, 4.5, 7.05],
  ['light error on paper', L.error, L.paper, 4.5, 6.54],
  ['light slate label on amber', L.onAccent, L.accent, 4.5, 7.28],
  ['light amber text on paper', L.accentText, L.paper, 4.5, 5.93],
  ['light amber fill next to primary', L.accent, L.primary, 3.0, 3.67],
  ['dark primary on background', D.primary, D.background, 4.5, 9.2],
  ['dark primary on paper', D.primary, D.paper, 4.5, 8.02],
  ['dark label on primary', D.onPrimary, D.primary, 4.5, 9.2],
  ['dark text.primary on background', D.textPrimary, D.background, 4.5, 15.35],
  ['dark text.secondary on background', D.textSecondary, D.background, 4.5, 7.09],
  ['dark text.secondary on paper', D.textSecondary, D.paper, 4.5, 6.18],
  ['dark amber on background', D.accent, D.background, 4.5, 9.05],
  ['dark error on background', D.error, D.background, 4.5, 7.96],
];

describe('brand tokens', () => {
  it('match the spec palette', () => {
    expect(L.primary).toBe('#0F5F66');
    expect(L.textPrimary).toBe('#1E293B');
    expect(L.accent).toBe('#F2A900');
    expect(L.accentText).toBe('#8A5A00');
    expect(D.primary).toBe('#5CC8D0');
    expect(D.background).toBe('#0E1719');
  });

  it.each(PAIRS)('%s meets its WCAG ratio', (_label, fg, bg, minimum, expected) => {
    const ratio = contrastRatio(fg, bg);
    expect(ratio).toBeGreaterThanOrEqual(minimum);
    expect(ratio).toBeCloseTo(expected, 1);
  });

  it('amber is fill-only on light surfaces: as text it fails AA', () => {
    expect(contrastRatio(L.accent, L.paper)).toBeLessThan(4.5);
  });

  it('keep the hairline divider visible on paper', () => {
    expect(contrastRatio(L.divider, L.paper)).toBeGreaterThan(1.1);
    expect(contrastRatio(D.divider, D.paper)).toBeGreaterThan(1.1);
  });
});

describe('Vault themes', () => {
  it('feed the tokens to the shell theme', () => {
    expect(vaultLightTheme.palette.mode).toBe('light');
    expect(vaultLightTheme.palette.primary.main).toBe(L.primary);
    expect(vaultLightTheme.palette.primary.contrastText).toBe(L.onPrimary);
    expect(vaultLightTheme.palette.secondary.main).toBe(L.accent);
    expect(vaultLightTheme.palette.background.default).toBe(L.background);
    expect(vaultLightTheme.palette.text.primary).toBe(L.textPrimary);
    expect(vaultDarkTheme.palette.mode).toBe('dark');
    expect(vaultDarkTheme.palette.primary.main).toBe(D.primary);
    expect(vaultDarkTheme.palette.background.paper).toBe(D.paper);
    expect(vaultDarkTheme.palette.error.main).toBe(D.error);
  });

  it('keep the shell base (Inter, 8px radius)', () => {
    expect(vaultLightTheme.typography.fontFamily).toContain('Inter');
    expect(vaultLightTheme.shape.borderRadius).toBe(8);
  });
});
