# The UX Refresh (E10)

> **Status:** specification for E10 of the platform migration (program epic [#54](https://github.com/marinoscar/vault/issues/54)); written in E0 ([#55](https://github.com/marinoscar/vault/issues/55)). **E10.1 ([#92](https://github.com/marinoscar/vault/issues/92)) and E10.2 ([#93](https://github.com/marinoscar/vault/issues/93)) are implemented**: the platform shell (`@marinoscar/platform-web@0.1.0-next.21`), the Vault brand theme and the destinations table (sections 2 to 5). **E10.4 ([#95](https://github.com/marinoscar/vault/issues/95)) is implemented**: the Secrets list on the platform datatable, the detail page and the version drawer (section 7). E10.3 and E10.5 to E10.7 are not: the settings hub, the cards gallery, the home dashboard and the accessibility pass are still to come. Web rules: [apps/web/AGENTS.md](../../apps/web/AGENTS.md); classification: [module-classification](../platform-adoption/module-classification.md); stop-gaps: [local-exceptions](../platform-adoption/local-exceptions.md).

## 1. Problems with today's UI

| Problem | Where | Effect |
|---|---|---|
| Flat sidebar of eight peers: Home, Secrets, Cards, Media, Secret Types, User Settings, User Management, System Settings | `components/navigation/Sidebar.tsx` | Settings and admin pages compete with daily destinations; no phone bottom bar; no distinction between "where I work" and "where I configure" |
| Settings are tabs (`SystemSettingsPage`: UI Settings, Feature Flags, AI, Backups, Advanced (JSON)); `UserSettingsPage` is one long page | `pages/SystemSettingsPage.tsx`, `UserSettingsPage.tsx` | A new setting means a new tab; deep links, permission gating and the phone layout are per-page ad hoc; "Advanced (JSON)" exposes raw settings |
| Lists are inconsistent: Secrets, Secret types, Media, Users, Allowlist each hand-roll tables or lists | `components/secrets/SecretsList.tsx`, `secret-types/SecretTypesList.tsx`, `media/*`, `admin/*` | Different sort, paging, empty and loading states; none collapse to cards on a phone the same way |
| The layout reads breakpoints itself | `Layout.tsx`, `Sidebar`, `AppBar` | Gates drift (some `md`, some `sm`) |
| Default MUI blue/purple theme, no Vault identity | `theme/light.ts` (`primary #1976d2`) | The logo in `media/` and the UI do not match |
| Home is a collection of cards (stats, quick actions, recent) with no urgency signal | `components/home/*` | Expiring cards and failed backups are not surfaced |

## 2. Navigation model

Destinations are declared **once** in `apps/web/src/config/destinations.ts` as the platform shell's `ShellDestination` table (created in E10). The bottom bar, the rail and the avatar menu all read it.

| id | Label | Route prefix | Gate (exact controller permission) | Pinned |
|---|---|---|---|---|
| `home` | Home | `/` | any signed-in user | no |
| `secrets` | Secrets | `/secrets` | `secrets:read` (`secrets.controller.ts`) | no |
| `cards` | Cards | `/cards` | `secrets:read` (cards are secrets of the Card type; `card-extract.controller.ts` write needs `secrets:write`) | no |
| `media` | Media | `/media` | `media:read` (`media.controller.ts`) | no |
| `settings` | Settings | `/settings` | any signed-in user (cards inside are gated) | **yes** |
| `console` | Console | `/admin/settings` | `system_settings:read` or `users:read` (the hub hides empty groups) | **yes** |

Rules (the platform's, restated because they bind Vault's table):

- **`pinned` means a mode, not a peer**: pinned items sit at the foot of the rail and in the avatar menu, never on the bottom bar. The app gives the bar `withoutPinned(NAVIGATION)`.
- **At most four non-pinned destinations**, so the phone bar has at most four tabs: Home, Secrets, Cards, Media. A fifth non-pinned destination is a redesign of the bar, not an addition. A destination the user cannot reach is hidden, not disabled.
- Secret types, backups, allowlist and the rest are **settings cards**, not destinations (section 5).
- Existing routes keep working: `/secrets/*`, `/cards/*`, `/media/*`, `/secret-types/*` (moved under the Secret types card, with a redirect), `/settings`, `/admin/users` (redirect to the Users card), `/admin/settings`.

**As built (E10.2).** `apps/web/src/config/destinations.ts` holds `DESTINATIONS`, `DESTINATION_ROUTES` and `UNOWNED_ROUTES`; `config/shell.ts` binds them into `VAULT_NAVIGATION` (with the Console registry and the compact AppBar's drill-down on `/admin/settings`) and derives `BOTTOM_BAR_NAVIGATION` (the non-pinned destinations). Ownership: `settings` owns `/settings` **and** `/secret-types` (until E10.3 moves the routes under the card); `console` owns all of `/admin`. `/login`, `/auth/callback`, `/activate` and `/testing/login` are owned by none. `config/adminSections.tsx` is seeded with the two admin pages that exist (System settings `system_settings:read`, Users & allowlist `users:read`) so Console mode has rows; E10.3 appends the rest. Secret types are reached from a "Secret types" card on `/settings` (`secret_types:read`). `__tests__/config/destinations.test.ts` asserts every `App.tsx` route is owned by exactly one destination or listed as unowned, at most four non-pinned, both pinned, and controller permission strings only.

## 3. Shell

- Use the platform `ShellLayout` (rail at `sm` and up, `ShellBottomNav` below), `ShellAppBar` (title resolved from the destination/card registry), `ShellUserMenu` and `createShellTheme` inside `ShellProviders`. `components/common/Layout.tsx` becomes a thin binding; `components/navigation/*` are deleted.
- Light, dark and system modes; the choice is the user's `Appearance` setting.
- The rail has a Console mode (admin cards) reachable from the pinned `console` item.

**As built (E10.2).** `components/common/Layout.tsx` binds `ShellLayout` with `ShellAppBar` (brand `BrandLockup`, theme toggle, `ShellUserMenu` with "Sign out"), the default `ShellNavigationRail` and `ShellBottomNav` over `BOTTOM_BAR_NAVIGATION`; pages render inside a `Suspense` and an `ErrorBoundary` keyed by path, so a lazy load or a page error keeps the chrome. `App.tsx` mounts `ShellRoot` (themes, the light / dark / system choice in `localStorage` `theme_mode`, synced from the `theme` user setting by `useUserSettings`), then Vault's `AuthProvider`, then `platform/PlatformAuthBridge.tsx` (re-publishes Vault's session as the platform identity context the shell reads; removed by E3.3) and a `ShellPreferencesProvider` keeping the rail's collapse in `localStorage` (Vault's `/api/user-settings` has no `navigation` namespace yet; removed by E4). `components/navigation/*`, `contexts/ThemeContext.tsx` and the old `theme/{light,dark,components}.ts` are deleted.

## 4. Breakpoint gates

The five coupled gates move together or not at all, boundary `sm` (600px), never `md`:

1. `ShellLayout` `showRail` (`up('sm')`)
2. `ShellBottomNav` self-gate (`down('sm')`)
3. `<main>` `pb: { xs: 10, sm: 3 }` in `ShellLayout`
4. `SettingsHub` `isCompactWindow` (`down('sm')`)
5. `ShellAppBar` `isCompactWindow` (`down('sm')`)

Since E10.2 all five are the platform's. The app reads no breakpoint for them; a web test (`apps/web/src/__tests__/config/breakpointGates.test.ts`) fails on any `useMediaQuery(` or `breakpoints.up|down(` in the app not listed with a reason. Domain pages may adapt to `sm` for their own content (e.g. the secrets list collapsing to cards) but are not gates.

## 5. Brand tokens

Keeps the logo in `media/app_logo.png`; replaces the default blue/purple with deep teal, slate neutrals and an amber accent. Tokens are defined once in `apps/web/src/theme/tokens.ts` (`BRAND_TOKENS`) and fed to `createShellTheme` by `theme/index.ts` (`vaultLightTheme`, `vaultDarkTheme`, `VAULT_THEMES`), with token-driven overrides for the AppBar border, cards, selected navigation rows, the bottom bar and the initials avatar; no component hard-codes a colour. Hairline `divider` tokens: `#E2E8F0` light, `#2A373B` dark (decorative, not a contrast pair).

### Palette

| Token | Light | Dark | Role |
|---|---|---|---|
| `primary.main` | `#0F5F66` | `#5CC8D0` | Buttons, links, active nav, focus ring |
| `primary.contrastText` | `#FFFFFF` | `#0E1719` | Text on primary |
| `accent` (secondary) | `#F2A900` | `#F2A900` | Highlights: expiring badge fill, selected-row marker, empty-state glyph. **Fill only; never text on light surfaces** |
| `background.default` | `#F5F7F8` | `#0E1719` | App background |
| `background.paper` | `#FFFFFF` | `#1A2427` | Cards, dialogs |
| `text.primary` | `#1E293B` | `#E6EDF0` | Body |
| `text.secondary` | `#475569` | `#94A3B8` | Captions, helper text |
| `error.main` | `#B3261E` | `#FF8A80` | Errors, destructive actions |
| `accent.text` (amber used as text) | `#8A5A00` | `#F2A900` | Amber-coloured words, if ever needed |

### Contrast (WCAG 2.x relative luminance, computed 2026-11-02)

| Pair | Ratio | Requirement | Result |
|---|---|---|---|
| Light: `primary #0F5F66` on `paper #FFFFFF` | 7.37:1 | 4.5 (text) | pass AA and AAA |
| Light: `primary` on `background #F5F7F8` | 6.86:1 | 4.5 | pass |
| Light: white on `primary` (button label) | 7.37:1 | 4.5 | pass |
| Light: `text.primary #1E293B` on `background #F5F7F8` | 13.61:1 | 4.5 | pass |
| Light: `text.primary` on white | 14.63:1 | 4.5 | pass |
| Light: `text.secondary #475569` on white / on `#F5F7F8` | 7.58:1 / 7.05:1 | 4.5 | pass |
| Light: `error #B3261E` on white | 6.54:1 | 4.5 | pass |
| Light: `accent #F2A900` with `#1E293B` text on it | 7.28:1 | 4.5 | pass (label on an amber chip) |
| Light: `accent #F2A900` on white as text | 2.01:1 | 4.5 | **fails**; hence fill-only |
| Light: `accent.text #8A5A00` on white | 5.93:1 | 4.5 | pass |
| Light: `accent` against `primary` (adjacent fills) | 3.67:1 | 3.0 (non-text) | pass |
| Dark: `primary #5CC8D0` on `background #0E1719` | 9.20:1 | 4.5 | pass |
| Dark: `primary` on `paper #1A2427` | 8.02:1 | 4.5 | pass |
| Dark: `#0E1719` on `primary` (button label) | 9.20:1 | 4.5 | pass |
| Dark: `text.primary #E6EDF0` on `background` | 15.35:1 | 4.5 | pass |
| Dark: `text.secondary #94A3B8` on `background` / on `paper` | 7.09:1 / 6.18:1 | 4.5 | pass |
| Dark: `accent #F2A900` on `background` | 9.05:1 | 4.5 | pass |
| Dark: `error #FF8A80` on `background` | 7.96:1 | 4.5 | pass |

**Re-measured in E10.1 (2026-11-02)** with `apps/web/src/theme/contrast.ts` over `tokens.ts`: every ratio above holds unchanged to two decimals, and `src/__tests__/theme/tokens.test.ts` fails if a token change breaks one. Status colours (valid / expiring soon / expired) must never rely on colour alone: each carries an icon and a text label.

### Mark and icons

Generate favicon, PWA and app-bar marks from `media/app_logo.png` and `media/favicon.ico`; tint the mark with `primary` in light and dark. No new logo is designed in E10.

**As built (E10.1).** The safe body is cropped out of the vignette, masked to its rounded square and its blues shifted to the teal primary; one tinted mark serves both modes (it reads on `#FFFFFF` and on `#0E1719`). Outputs: `apps/web/src/assets/brand/vault-mark.png` (128px, drawn at 32px by `components/brand/BrandLockup.tsx`), `public/favicon.ico` (16/32/48), `public/icons/icon-{192,512,1024}.png` and `public/apple-touch-icon.png` (the mark on `#F5F7F8` with a maskable safe margin). `index.html` `theme-color` and `manifest.json` use `#0F5F66` / `#F5F7F8`. `media/` keeps the untinted source.

## 6. Settings hub

`/settings` (user) and `/admin/settings` (Console) are bindings of the packaged `SettingsHub` over two registries created in E10: `apps/web/src/config/userSettingsSections.tsx` (`USER_SETTINGS_SECTIONS`) and `adminSections.tsx` (`ADMIN_SECTIONS`). A card is `{ title, description, Icon, path?, disabled?, permission?, feature?, alwaysShow? }`. Rules: [AGENTS.md](../../AGENTS.md#mandatory-settings-ui-pattern-target-from-e10-rule-for-new-pages-now). Each card's `permission` is **the exact string the controller enforces**.

### Admin cards (`ADMIN_SECTIONS`)

| Card | Replaces | `permission` (controller) | Notes |
|---|---|---|---|
| Users & allowlist | `UserManagementPage` | `users:read` (`users.controller.ts`) | Packaged identity page (Users and Allowlist tabs, parallel content). Allowlist tab content gated by `allowlist:read` (`allowlist.controller.ts`); writes `users:write`, `allowlist:write` |
| Backups | `ScheduledBackups`, `BackupRunsTable` admin side | `system_settings:read` (`backups.controller.ts` `GET admin/backups/schedule`, list); run, export, delete, save schedule need `system_settings:write` | Schedule, contents, retention, run now, download. Password write-only |
| AI | Settings tab "AI" | `system_settings:read` today (`ai-verify.controller.ts` verify needs `system_settings:write`); after E8 the platform AI page's own permission (read it from the installed controller) | The card that switches AI on; carries no `feature` |
| Card scanning | part of the AI tab | `system_settings:read` | `feature: 'ai'`; model, daily budget. Sections slot of the AI page after E8 |
| Storage | storage config | platform storage controller permission (E6) | |
| General | UI Settings, Feature Flags tabs | `system_settings:read` / `:write` (`system-settings.controller.ts`) | "Advanced (JSON)" is dropped unless E10.2 records a need |
| Doctor, Jobs, Telemetry | new | the platform controllers' permissions | Appear as their slices land (E5, E9) |

### User cards (`USER_SETTINGS_SECTIONS`)

| Card | Replaces | `permission` | Notes |
|---|---|---|---|
| Profile | profile section | `user_settings:read` (`user-settings.controller.ts`); writes `user_settings:write` | Packaged `UserProfilePage` |
| Appearance | `ThemeSettings` | `user_settings:read` | Light / dark / system |
| Access tokens | `PersonalAccessTokens` | none: ownership-scoped (`pat.controller.ts` bare `@Auth()`) | One-time token reveal kept |
| My backups | `DataBackup` | `secrets:read` (`my-backups.controller.ts`) | Save to storage, list (newest 10 kept), download, delete; password in memory only |
| Secret types | `/secret-types` pages | `secret_types:read` (`secret-types.controller.ts`); create/edit `secret_types:write`; delete `secret_types:delete` | System types read-only |
| AI keys | none today | `ai:use` after E8 | `feature: 'ai'` |

Tabs appear only inside one destination for parallel content (Users and Allowlist). Nothing else is a tab.

## 7. Secrets list

The Secrets destination uses `@marinoscar/platform-web/datatable` (`DataTable`, responsive card mode), replacing `SecretsList.tsx`.

- Server-driven: `GET /api/secrets` already takes `page`, `pageSize` (max 100), `typeId`, `search` and `sortBy` (`createdAt` | `name` | `updatedAt`). Sort and filter state live in the URL.
- Columns (today's list): name, type, version, updated, actions. **No secret values are ever in a row** (list responses are not decrypted).
- Toolbar: search, type filter (system + custom types), "New secret".
- Phone (< 600px): rows become cards (name, type, updated); the row action is the same. Empty and loading states are the datatable's.
- Row action opens the detail page; **version history** opens in a drawer from the detail page (`SecretVersionHistory`) (today `SecretVersionHistory`: list versions, roll back); rollback creates a new current version. Version compare is out of scope unless E10.4 adds it.
- Per-user column preferences use the datatable preferences port (`/user-settings`).
- Secret detail: values masked until revealed, copy with `useCopyToClipboard`, attachments with refcounted delete. Keyboard reachable.

**As built (E10.4, #95).**

- **List** (`pages/SecretsPage.tsx`, `components/secrets/SecretsTable.tsx`, replacing `SecretsList.tsx`): the platform `DataTable` (`@marinoscar/platform-web/datatable`, `tableId: 'secrets'`, peer `@mui/x-data-grid`), server-driven. Search (the datatable's `QuickSearchField`, debounced), type, sort (`name` / `updatedAt`, plus `createdAt` accepted from the URL) and page live in the URL (`?q=&type=&sort=&dir=&page=&size=`); defaults (`updatedAt desc`, page 1, 20 rows) are omitted. A link that names `sort` or `size` wins over the stored layout. The grid shows Name (type avatar and a link to the detail page), Description, Type, Version and Updated; from the table's own container width (it measures itself; `tabletBreakpoint` 840) it folds Version behind a row expander, and below 600px it renders cards. The page learns the layout through the datatable's `Toolbar` slot and gives the card list its own columns (name and description; type, age and version on one line), so the app still reads no breakpoint. Row actions: Open, Edit, Renew card (card rows; the Cards renewal flow), Delete (the table's confirm); write actions are hidden without `secrets:write` / `secrets:delete`, and "New secret" without `secrets:write`. Empty (first run, no match with "Clear filters"), loading and error states use the table's overlays.
- **Row click**: the platform table has no row-click callback, so the name is a real link and "Open" is the first row action (keyboard reachable on both renderers).
- **Column preferences**: the datatable port is a `localStorage` stop-gap (`platform/dataTablePreferences.ts`, `PLATFORM-ADOPTION-SHIM(E4)`), because Vault's `/api/user-settings` has no `dataTables` namespace yet ([local-exceptions](../platform-adoption/local-exceptions.md)).
- **Detail** (`pages/SecretDetailPage.tsx`): header with the type avatar, name, type chip, "Updated ..." and version; History, Edit and a menu (Renew card for cards, Download JSON, Delete). Card secrets also show a link to Cards and to renewal. Details and Attachments stay tabs (parallel content; card photos never share a screen with the card number). Each field is a `SecretValueField`: sensitive values masked until revealed, masked again after 30 s and on navigation, copy from the stored value (card fields reformatted) with the clipboard cleared after 30 s when readback confirms it still holds the value; outcomes are announced in a polite live region and no value reaches an accessible name. There is no reveal or copy audit endpoint, so none is called. Page containers add no padding of their own on top of the shell's `<main>`.
- **Version history** (`components/secrets/SecretVersionDrawer.tsx`, replacing `SecretVersionHistory.tsx` and the version dialog): a right drawer (full width on a phone) listing versions; a historical version opens a field-by-field comparison with the current values (Changed / Added / Removed / Same, glyph plus word), sensitive values masked behind "Show values", that version's own card photos, and "Restore version N" (confirmed; `POST /secrets/:id/versions/:versionId/rollback`, which creates a new current version).
- **Create / Edit** (`components/secrets/SecretForm.tsx`): the type's fields from its schema, validated before sending with the API's rules (`utils/secretFields.ts`: required, number, date, select option, name and description bounds); only declared, non-empty fields are sent, and an emptied description is cleared with `null`. Choosing the Card type points to the Cards scan flow. The API contract is unchanged.
- Tests: `__tests__/components/secrets/{SecretsTable,SecretValueField,SecretVersionDrawer,SecretForm}.test.tsx`, `__tests__/pages/{SecretsPage,SecretDetailPage,SecretFormPages}.test.tsx`, `__tests__/utils/secretFields.test.ts`, `__tests__/platform/dataTablePreferences.test.ts`.

## 8. Cards gallery

The Cards destination shows cards (secrets of the Card type) as a gallery of `CardTile`s: `CardTile` content as today plus `CardExpiryBadge`; never the full number or the CVV.

- Expiry statuses come from `utils/cardExpiry.ts`: `expired`, `expiring_soon` (within `EXPIRING_SOON_DAYS` = 60), `valid`, `unknown`. Default sort: soonest expiry first. Each status has an icon and a label (not colour only); `expiring_soon` uses the amber accent fill with slate text.
- Actions: Import (scan) opens the capture/crop/review flow, `renew` creates a new version swapping only the supplied roles (`card_front`, `card_back`).
- Scanning shows `AiEgressNotice` (photos leave the deployment to the configured provider); hidden when AI is off (`GET /api/ai/status`). The CVV is never extracted or shown in the gallery.
- Phone: single column, uniform tile height. Today `CardsPage` is already a grid (`xs=12 sm=6 md=4`); E10 keeps it and adds the shell and badge tokens.

## 9. Home dashboard

Replaces the stats/quick-actions/recent mix with three urgency-first panels (each hides if the user lacks its permission):

| Panel | Source | Gate |
|---|---|---|
| Expiring cards | cards with `expired` or `expiring_soon`, soonest first, link to renew | `secrets:read` |
| Recent secrets | `GET /api/secrets?sortBy=updatedAt` (names and types only) | `secrets:read` |
| Last backup status | `GET /api/backups/me` (own) and, for admins, `GET /api/admin/backups` (latest run, status, size, age); a failed or stale (> schedule interval) run shows an error state with a link to the Backups card | `secrets:read`; admin part `system_settings:read` |

Also a compact "Recent media" strip (`media:read`) and quick actions (New secret, Scan card, Upload) gated by `secrets:write` / `media:write`. On first run with no secrets, a single empty-state call to action.

## 10. Accessibility

- WCAG 2.2 AA: contrast per section 5, visible focus ring in `primary`, target size >= 44px on the bottom bar, 24px minimum elsewhere.
- Every icon-only button has an accessible name; status is never colour alone; dialogs trap and restore focus; the shell landmarks (`banner`, `navigation`, `main`) are the platform's.
- Revealed secret values are announced on reveal and re-masked on a timer or navigation; copy confirmation is a polite live region.
- Respect `prefers-reduced-motion` and `prefers-color-scheme` (system mode).
- No secret value in the document title, URL, `aria-label` of a row, or screenshot fixtures.

## 11. Test plan

| Layer | What | Where |
|---|---|---|
| Registry unit tests (Vitest) | every admin and user card has a route, a permission that matches the controller strings above, and `feature` only where specified; destinations table: <= 4 non-pinned, `settings`/`console` pinned, `withoutPinned` | `apps/web/src/__tests__/config/` (created in E10) |
| Breakpoint gate test | no unlisted `useMediaQuery(` / `breakpoints.up|down(` | `__tests__/config/breakpointGates.test.ts` |
| Component tests | secrets list (search, type filter, sort, card mode), cards gallery statuses, home panels permission hiding, backups card (password write-only) | `__tests__/pages`, `__tests__/components` |
| Contrast check | the table in section 5 recomputed from the theme tokens | a unit test over `tokens.ts` |
| E2E (Playwright) | sign in (test login), navigate Home / Secrets / Cards / Media at 1280px (rail) and 390px (bottom bar, four tabs), create a secret, view history, open settings hub and Console | `tests/e2e/specs/` |
| Visual | screenshots of Home, Secrets, Cards, Settings hub in light, dark, desktop, phone (invented data only) | `tests/e2e` (policy decided in E10.7) |

All fixtures use invented data (`Person A`, `@example.test`, published test card numbers).

## 12. Issue mapping

| Issue | Scope | Depends on |
|---|---|---|
| E10.1 (#92, done) | Brand tokens and theme: `tokens.ts`, `createShellTheme`, light/dark/system, icons from `media/`, contrast test | E1 |
| E10.2 (#93, done) | Shell and destinations: `destinations.ts`, `ShellLayout` binding, delete `components/navigation/*` and `Layout` breakpoints, gate test | E3, E10.1 |
| E10.3 | Settings hub: `adminSections.tsx`, `userSettingsSections.tsx`, move existing settings content into cards, redirect old routes, registry tests | E4, E10.2 |
| E10.4 (#95, done) | Secrets list on datatable with card mode, URL state, version history drawer with diff and rollback, detail and form redesign | E10.2 |
| E10.5 | Cards gallery and expiry statuses | E10.2 |
| E10.6 | Home dashboard (expiring cards, recent secrets, last backup status) | E10.2, E5 for job-based backup status |
| E10.7 | Accessibility pass, Playwright e2e and visual baselines, docs update | E10.1 to E10.6 |

E10.1 is #92 and E10.2 is #93; the other numbers are assigned as each starts.
