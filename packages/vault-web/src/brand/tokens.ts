/**
 * Vault brand tokens (E10.1, issue #92; spec: docs/specs/ux-refresh.md §5).
 *
 * The ONE place a brand colour is written. `theme/index.ts` feeds these to the
 * platform shell's `createShellTheme`; no component hard-codes a colour.
 *
 * Deep teal primary, slate neutrals, an amber accent. The amber is a FILL
 * colour only: as text on a light surface it reads 2.01:1 and fails WCAG AA,
 * so amber words use `accentText` (#8A5A00, 5.93:1 on white). The contrast of
 * every pair the UI relies on is asserted by
 * `src/__tests__/theme/tokens.test.ts` with `theme/contrast.ts`.
 */

export type BrandMode = 'light' | 'dark';

/** The colour roles of one mode. */
export interface BrandModeTokens {
  /** Buttons, links, the active navigation row, the focus ring. */
  primary: string;
  /** A lighter and a darker step of `primary` (hover, pressed, tonal surfaces). */
  primaryLight: string;
  primaryDark: string;
  /** Text and icons on a `primary` fill. */
  onPrimary: string;
  /** The amber accent: badge fills, selected-row markers, empty-state glyphs. Fill only. */
  accent: string;
  /** Text on an `accent` fill. */
  onAccent: string;
  /** Amber used as text, when it must be. */
  accentText: string;
  /** App background. */
  background: string;
  /** Cards, dialogs, the app bar and the rail. */
  paper: string;
  /** Body text. */
  textPrimary: string;
  /** Captions, helper text, inactive navigation. */
  textSecondary: string;
  /** Errors and destructive actions. */
  error: string;
  /** Hairlines: the app bar's border, the rail's edge, dividers. */
  divider: string;
}

export const BRAND_TOKENS: Readonly<Record<BrandMode, BrandModeTokens>> = {
  light: {
    primary: '#0F5F66',
    primaryLight: '#3D8A90',
    primaryDark: '#0A4348',
    onPrimary: '#FFFFFF',
    accent: '#F2A900',
    onAccent: '#1E293B',
    accentText: '#8A5A00',
    background: '#F5F7F8',
    paper: '#FFFFFF',
    textPrimary: '#1E293B',
    textSecondary: '#475569',
    error: '#B3261E',
    divider: '#E2E8F0',
  },
  dark: {
    primary: '#5CC8D0',
    primaryLight: '#8ADBE0',
    primaryDark: '#2FA3AC',
    onPrimary: '#0E1719',
    accent: '#F2A900',
    onAccent: '#1E293B',
    accentText: '#F2A900',
    background: '#0E1719',
    paper: '#1A2427',
    textPrimary: '#E6EDF0',
    textSecondary: '#94A3B8',
    error: '#FF8A80',
    divider: '#2A373B',
  },
};

/** The browser chrome colour (`<meta name="theme-color">`, the PWA manifest). */
export const BRAND_THEME_COLOR = BRAND_TOKENS.light.primary;

/** The product name shown in the app bar and the document title. */
export const PRODUCT_NAME = 'Vault';

/**
 * The one-line product promise under the sign-in heading. Mirrors `tagline`
 * in `packages/shared/identity.json` (the rebrand source);
 * `__tests__/theme/tokens.test.ts` fails when the two drift.
 */
export const PRODUCT_TAGLINE = 'Your secrets, cards and documents, encrypted and versioned.';
