/**
 * The two Vault themes (E10.1, issue #92): the platform shell's base
 * (`createShellTheme`: Inter, 600-weight headings, 8px radius, no-uppercase
 * buttons, flat AppBar) with the Vault palette from `tokens.ts` and a few
 * component overrides that read the tokens instead of the shell's neutral
 * greys.
 *
 * The viewer's light / dark / system choice is held by the shell's `ShellRoot`
 * (App.tsx), persisted in this browser and synced from the `theme` user
 * setting by `useUserSettings`. This file only builds the two themes, once.
 */

import { alpha, createTheme } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import { createShellTheme } from '@marinoscar/platform-web/shell/headless';

import { BRAND_TOKENS } from './tokens';
import type { BrandMode } from './tokens';

export { BRAND_TOKENS, BRAND_THEME_COLOR, PRODUCT_NAME } from './tokens';
export type { BrandMode, BrandModeTokens } from './tokens';

/** The modes the Appearance setting offers. */
export type ThemeMode = 'light' | 'dark' | 'system';

function createVaultTheme(mode: BrandMode): Theme {
  const t = BRAND_TOKENS[mode];
  return createShellTheme(mode, {
    palette: {
      primary: { main: t.primary, light: t.primaryLight, dark: t.primaryDark, contrastText: t.onPrimary },
      secondary: { main: t.accent, contrastText: t.onAccent },
      error: { main: t.error },
      background: { default: t.background, paper: t.paper },
      text: { primary: t.textPrimary, secondary: t.textSecondary },
      divider: t.divider,
    },
    extend: (base) =>
      createTheme(base, {
        components: {
          MuiCssBaseline: {
            styleOverrides: {
              body: { WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' },
            },
          },
          MuiAppBar: {
            styleOverrides: {
              root: { boxShadow: 'none', borderBottom: `1px solid ${t.divider}`, backgroundImage: 'none' },
            },
          },
          MuiPaper: {
            styleOverrides: { root: { backgroundImage: 'none' } },
          },
          MuiCard: {
            styleOverrides: {
              root: {
                border: `1px solid ${t.divider}`,
                boxShadow: mode === 'light' ? '0 1px 2px rgba(15, 23, 42, 0.06)' : 'none',
              },
            },
          },
          MuiListItemButton: {
            styleOverrides: {
              root: {
                '&.Mui-selected': {
                  backgroundColor: alpha(t.primary, mode === 'light' ? 0.1 : 0.16),
                  '&:hover': { backgroundColor: alpha(t.primary, mode === 'light' ? 0.14 : 0.22) },
                },
              },
            },
          },
          MuiAvatar: {
            styleOverrides: {
              // The user menu's initials avatar: a tonal primary chip, not MUI's grey.
              colorDefault: { backgroundColor: alpha(t.primary, mode === 'light' ? 0.12 : 0.2), color: t.primary, fontWeight: 600 },
            },
          },
          MuiBottomNavigation: {
            styleOverrides: { root: { borderTop: `1px solid ${t.divider}` } },
          },
          MuiBottomNavigationAction: {
            styleOverrides: { root: { color: t.textSecondary, '&.Mui-selected': { color: t.primary } } },
          },
        },
      }),
  });
}

/** The Vault light theme, built once. */
export const vaultLightTheme: Theme = createVaultTheme('light');

/** The Vault dark theme, built once. */
export const vaultDarkTheme: Theme = createVaultTheme('dark');

/** The themes `ShellRoot` takes. */
export const VAULT_THEMES = { light: vaultLightTheme, dark: vaultDarkTheme } as const;
