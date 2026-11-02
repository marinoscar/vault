/**
 * The Vault themes are the package's (E12.3, #104): `@marinoscar/vault-web/brand`
 * builds both modes from its token map (`BRAND_TOKENS`). The host only passes
 * them to `ShellRoot` (App.tsx). Change a token in the package, never here.
 */
export {
  BRAND_THEME_COLOR,
  BRAND_TOKENS,
  PRODUCT_NAME,
  VAULT_THEMES,
  vaultDarkTheme,
  vaultLightTheme,
} from '@marinoscar/vault-web/brand';
export type { BrandMode, BrandModeTokens, ThemeMode } from '@marinoscar/vault-web/brand';
