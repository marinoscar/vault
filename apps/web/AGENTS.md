# apps/web rules

Root rules ([AGENTS.md](../../AGENTS.md)) apply. This file is what to get right when editing the React app. Target UX: [docs/specs/ux-refresh.md](../../docs/specs/ux-refresh.md).

## Layout

- `src/pages/` (HomePage, SecretsPage, SecretDetailPage, Create/EditSecretPage, CardsPage, ImportCardPage, RenewCardPage, SecretTypesPage and editors, Media* pages, SystemSettingsPage, UserSettingsPage, UserManagementPage, LoginPage, auth/device pages), `src/components/` (`admin`, `auth`, `brand` (`BrandLockup`), `cards`, `common` incl. `Layout.tsx` and `ProtectedRoute`, `device-activation`, `home`, `media`, `secret-types`, `secrets`, `settings`, `user`), `src/config/` (`destinations.ts`, `shell.ts`, `adminSections.tsx`), `src/platform/` (`PlatformAuthBridge.tsx`, `shellPreferences.ts`, `dataTablePreferences.ts`: stop-gaps listed in local-exceptions), `src/hooks/`, `src/contexts/` (`AuthContext`), `src/services/api.ts`, `src/theme/` (`tokens.ts`, `contrast.ts`, `index.ts`), `src/assets/brand/`, `src/utils/`, `src/types/`.
- Routes live in `src/App.tsx`. Tests: `src/__tests__/` (**Vitest** + React Testing Library; `components/`, `config/`, `hooks/`, `pages/`, `services/`, `theme/`, `utils/` (incl. `viewport.ts` to size the window for the shell), `mocks/`, `setup.ts`).
- **The shell is the platform's** (`@marinoscar/platform-web@0.1.0-next.21`, E10.1/E10.2, #92/#93): `App.tsx` mounts `ShellRoot` (Vault themes, light / dark / system), Vault's `AuthProvider`, `PlatformAuthBridge` (Vault's session as the platform identity context the shell reads, until E3.3) and `ShellPreferencesProvider` (rail collapse in `localStorage`, until E4). `components/common/Layout.tsx` is a thin `ShellLayout` binding. Identity UI, settings hub, datatable and AI pages come from the platform in E3 to E10.3+; domain pages (secrets, cards, media, backups UI) stay here until E12.

## Stack

React 19, MUI 9 (`@mui/material`, `@mui/icons-material`), react-router-dom 7, Vite 8, Vitest 4 + React Testing Library 16 + jsdom 29, aligned with the peer dependencies of `@marinoscar/platform-web` (E1.3, #70). MUI 9 conventions:

- No system props on `Box`, `Stack`, `Typography`, `Grid`: put `color`, `fontWeight`, `display`, `alignItems` and friends in `sx`. `Typography` has no `paragraph` (use `sx={{ marginBottom: '16px' }}`).
- `Grid` is the v2 API: `<Grid size={{ xs: 12, md: 6 }}>`, no `item`, no `xs`/`md` props.
- Slot props, never the removed `*Props`: `slotProps.input`/`htmlInput`/`inputLabel`/`select` on `TextField`, `slotProps.primary`/`secondary` on `ListItemText`, `slotProps.paper` on `Menu`.
- `*Outline` icons are gone: use `*OutlineOutlined` (same glyph; `*Outlined` is the filled one).
- A `Switch` has the ARIA role `switch`, not `checkbox`; query it with `getByRole('switch', ...)`.
- Tests: an MSW handler must not call `request.formData()` on an upload (undici cannot read a jsdom `File`); spy on `FormData.prototype.append` instead (see `ImportCardPage.test.tsx`).
- Lists use the platform `DataTable` (`@marinoscar/platform-web/datatable/ui`, peer `@mui/x-data-grid`; E10.4). It picks grid or cards from its own container width, so a page reads no breakpoint; tests call `installLayoutStubs()` and `setInitialContainerWidth(1400 | 360)` from `/datatable/testing` (see `SecretsTable.test.tsx`).

## Stack

React 19, MUI 9 (`@mui/material`, `@mui/icons-material`), react-router-dom 7, Vite 8, Vitest 4 + React Testing Library 16 + jsdom 29, aligned with the peer dependencies of `@marinoscar/platform-web` (E1.3, #70). MUI 9 conventions:

- No system props on `Box`, `Stack`, `Typography`, `Grid`: put `color`, `fontWeight`, `display`, `alignItems` and friends in `sx`. `Typography` has no `paragraph` (use `sx={{ marginBottom: '16px' }}`).
- `Grid` is the v2 API: `<Grid size={{ xs: 12, md: 6 }}>`, no `item`, no `xs`/`md` props.
- Slot props, never the removed `*Props`: `slotProps.input`/`htmlInput`/`inputLabel`/`select` on `TextField`, `slotProps.primary`/`secondary` on `ListItemText`, `slotProps.paper` on `Menu`.
- `*Outline` icons are gone: use `*OutlineOutlined` (same glyph; `*Outlined` is the filled one).
- A `Switch` has the ARIA role `switch`, not `checkbox`; query it with `getByRole('switch', ...)`.
- Tests: an MSW handler must not call `request.formData()` on an upload (undici cannot read a jsdom `File`); spy on `FormData.prototype.append` instead (see `ImportCardPage.test.tsx`).

## Rules

- **Settings UI** (root rule; the registry exists from E10): a new settings page is a card appended to a registry, never a new tab of `SystemSettingsPage`/`UserSettingsPage`; a card's `permission` is the exact string the API controller enforces; reuse `SettingsHub`, never fork. Recipe: [`add-settings-page` skill](../../.claude/skills/add-settings-page/SKILL.md).
- **Breakpoint gates**: the five coupled gates all sit at `sm` (600px), never `md`, and they are the platform shell's. The app reads no breakpoint for them: `__tests__/config/breakpointGates.test.ts` fails on any `useMediaQuery(` or `breakpoints.up|down|between|only(` in `src/` not listed there with a reason (a domain page adapting its own content may be listed; navigation chrome never).
- **Navigation**: destinations are declared once in `src/config/destinations.ts` (`DESTINATIONS`, `DESTINATION_ROUTES`, `UNOWNED_ROUTES`) as `ShellDestination`s and bound in `config/shell.ts`; Home, Secrets, Cards, Media are non-pinned; Settings and Console are `pinned` (a mode, not a peer) and never on the bottom bar (`BOTTOM_BAR_NAVIGATION`); at most **four** non-pinned. A new route must be owned by exactly one destination (or listed in `UNOWNED_ROUTES`): `__tests__/config/destinations.test.ts` reads `App.tsx` and fails otherwise. A destination's `permission` / `anyPermission` is the exact controller string.
- **Brand**: colours live only in `src/theme/tokens.ts` (`BRAND_TOKENS`); `theme/index.ts` feeds them to `createShellTheme`. Amber (`accent`) is a fill, never text on a light surface (use `accentText`). Changing a token keeps `__tests__/theme/tokens.test.ts` (WCAG ratios from spec section 5) green. Read the theme through `useTheme()`/`sx` palette keys; the light / dark choice through `useShellTheme()` / `useOptionalShellTheme()` of `@marinoscar/platform-web/shell/headless` (there is no app `ThemeContext`).
- **The UI presents; the API authorizes.** Hiding a card or button is not security. Gate with `usePermissions` / `RequirePermission` using the same permission strings as the controllers.
- **Never keep secret values longer than needed**: list responses are not decrypted, so values come only from the detail view; copy through `useCopyToClipboard`; never put a value in `localStorage`, logs or error reports. Backup passwords are held in component state only and never persisted.
- **Never call an AI provider from the browser**; card scanning goes through `POST /api/secrets/cards/extract` and shows `AiEgressNotice`. The CVV is never sent.
- Use MUI theming (`src/theme/`) and the responsive layout; no hard-coded colours outside `theme/tokens.ts`. Brand tokens are specified in `ux-refresh.md` section 5.
- Tests render through `__tests__/utils/test-utils.tsx` (`ShellRoot` + mock `AuthContext` + `PlatformAuthBridge` + `ShellPreferencesProvider`); to test the shell at a width call `setViewportWidth(390 | 1440)` from `utils/viewport.ts` and `restoreViewport()` after.
- Runtime-configured features (storage, AI, SMTP, VAPID) are admin-UI settings, never build-time variables.
- Write components and hooks with tests; a behaviour change carries its tests in the same or next commit. Tests use invented data (placeholders, test PANs).

Run (from `apps/web`): `npm run test:run`, `npm run typecheck`, `npm run typecheck:test`, `npm run build`.
