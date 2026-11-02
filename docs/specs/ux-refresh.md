# The UX Refresh (E10)

> **Status:** specification for E10 of the platform migration (program epic [#54](https://github.com/marinoscar/vault/issues/54)); written in E0 ([#55](https://github.com/marinoscar/vault/issues/55)). **Implemented:** E10.1 ([#92](https://github.com/marinoscar/vault/issues/92)) and E10.2 ([#93](https://github.com/marinoscar/vault/issues/93)), the platform shell (`@marinoscar/platform-web@0.1.0-next.21`), the Vault brand theme and the destinations table (sections 2 to 5); E10.3 ([#94](https://github.com/marinoscar/vault/issues/94)), the settings hubs (section 6); E10.4 ([#95](https://github.com/marinoscar/vault/issues/95)), the Secrets list on the platform datatable, the detail page and the version drawer (section 7); E10.6 ([#97](https://github.com/marinoscar/vault/issues/97)), the home dashboard (section 9). E10.5 and E10.7 (the cards gallery and the accessibility pass) are still to come. Web rules: [apps/web/AGENTS.md](../../apps/web/AGENTS.md); classification: [module-classification](../platform-adoption/module-classification.md); stop-gaps: [local-exceptions](../platform-adoption/local-exceptions.md).

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

**As built (E10.2).** `components/common/Layout.tsx` binds `ShellLayout` with `ShellAppBar` (brand `BrandLockup`, theme toggle, `ShellUserMenu` with "Sign out"), the default `ShellNavigationRail` and `ShellBottomNav` over `BOTTOM_BAR_NAVIGATION`; pages render inside a `Suspense` and an `ErrorBoundary` keyed by path, so a lazy load or a page error keeps the chrome. `App.tsx` mounts `ShellRoot` (themes, the light / dark / system choice in `localStorage` `theme_mode`, synced from the `theme` user setting by `useUserSettings`), then (since E3.3) the platform's identity providers (`identity/IdentityProviders.tsx`: `AuthProvider` over Vault's `PlatformHttpClient`, the identity adapters, the table-layout store) and the platform host (`platform/platformHost.tsx`) and a `ShellPreferencesProvider` keeping the rail's collapse in `localStorage` (Vault's `/api/user-settings` has no `navigation` namespace yet; removed by E4). `components/navigation/*`, `contexts/ThemeContext.tsx` and the old `theme/{light,dark,components}.ts` are deleted.

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

`/settings` (user) and `/admin/settings` (Console) are bindings of the packaged `SettingsHub` over two registries created in E10: `apps/web/src/config/userSettingsSections.tsx` (`USER_SETTINGS_SECTIONS`) and `adminSections.tsx` (`ADMIN_SECTIONS`). A card is `{ title, description, Icon, path?, disabled?, permission?, feature?, alwaysShow? }`. Rules: [AGENTS.md](../../AGENTS.md#mandatory-settings-ui-pattern). Each card's `permission` is **the exact string the controller enforces**.

### Admin cards (`ADMIN_SECTIONS`)

| Card | Replaces | `permission` (controller) | Notes |
|---|---|---|---|
| Users & allowlist | `UserManagementPage` | `users:read` (`users.controller.ts`) | Packaged identity page (Users and Allowlist tabs, parallel content). Allowlist tab content gated by `allowlist:read` (`allowlist.controller.ts`); writes `users:write`, `allowlist:write` |
| Backups | `ScheduledBackups`, `BackupRunsTable` admin side | `system_settings:read` (`backups.controller.ts` `GET admin/backups/schedule`, list); run, export, delete, save schedule need `system_settings:write` | Schedule, contents, retention, run now, download. Password write-only |
| AI | Settings tab "AI" | `ai_config:read` since E8.2 (platform `ai-admin.controller` `GET /api/admin/ai/config`); writes `ai_config:write` | The card that switches AI on; carries no `feature`. The packaged `AiConfigPage` |
| Card scanning | part of the AI tab | `system_settings:read` / `:write` (it saves `ai.cardExtractModel` through `system-settings.controller.ts`) | Not a card since E8.2: the `Card scanning model` section in the `AfterContent` slot of the AI page. The daily budget is the platform's `ai.limits` on the same page |
| AI models, AI usage | new (E8.2) | `ai_config:read` (`ai-admin.controller` `GET /api/admin/ai/models`, `ai-usage-admin.controller` `GET /api/admin/ai/usage`) | `feature: 'ai'`; see the as-built table below |
| Storage | `STORAGE_PROVIDER`, `S3_*`, `AWS_*` environment variables | `storage_config:read` (E6.1; platform `storage-config.controller` `GET /api/admin/storage-config`); save, test and Create bucket `storage_config:write` | The packaged `StorageConfigPage` of `@marinoscar/platform-web/storage/ui`; no `feature`; see the as-built table below |
| General | UI Settings, Feature Flags tabs | `system_settings:read` / `:write` (`system-settings.controller.ts`) | "Advanced (JSON)" is dropped unless E10.2 records a need |
| Doctor, Jobs, Telemetry | new | the platform controllers' permissions | Appear as their slices land (E5, E9) |
| Email, Web Push, Broadcasts | new | `system_settings:read`, `push:read`, `broadcasts:read` (the platform email and notifications controllers) | E7.2; see the as-built table below |

### User cards (`USER_SETTINGS_SECTIONS`)

| Card | Replaces | `permission` | Notes |
|---|---|---|---|
| Profile | profile section | `user_settings:read` (`user-settings.controller.ts`); writes `user_settings:write` | Packaged `UserProfilePage` |
| Appearance | `ThemeSettings` | `user_settings:read` | Light / dark / system |
| Access tokens | `PersonalAccessTokens` | none: ownership-scoped (`pat.controller.ts` bare `@Auth()`) | One-time token reveal kept |
| My backups | `DataBackup` | `secrets:read` (`my-backups.controller.ts`) | Save to storage, list (newest 10 kept), download, delete; password in memory only |
| Secret types | `/secret-types` pages | `secret_types:read` (`secret-types.controller.ts`); create/edit `secret_types:write`; delete `secret_types:delete` | System types read-only |
| AI keys | none today | `ai:use` after E8 | `feature: 'ai'` |
| Notifications | none today | `user_settings:read` | E7.2: the packaged preference matrix |

Tabs appear only inside one destination for parallel content (Users and Allowlist). Nothing else is a tab.

**As built (E10.3, [#94](https://github.com/marinoscar/vault/issues/94)).** `/settings` (`pages/UserSettingsHubPage.tsx`) and `/admin/settings` (`pages/admin/AdminSettingsHubPage.tsx`) are thin bindings of the packaged `SettingsHub` (`sections`, `hubKey`, `title`, `subtitle`, `hasPermission` from `usePermissions`; since E8.2 also `features={useSettingsFeatures()}`, the resolvers of `config/settingsFeatures.ts`, so the `feature: 'ai'` cards hide while AI is off). The tab-based `SystemSettingsPage` and the stacked `UserSettingsPage` are deleted; each card is its own routed page built from the existing components without logic change, inside a shared `components/settings/SettingsPageFrame.tsx` (the packaged pages' container and heading).

| Registry | Card | Route | `permission` | Page |
|---|---|---|---|---|
| `ADMIN_SECTIONS`, Administration | General | `/admin/settings/general` | `system_settings:read` | `pages/admin/GeneralSettingsPage.tsx`: `UISettings` + `FeatureFlagsList` (was two tabs); controls disabled without `system_settings:write` |
| | Users & Allowlist | `/admin/settings/users` | `users:read` | packaged `UsersPage` (`@marinoscar/platform-web/identity/ui`; Users and Allowlist tabs: parallel content); the card is `identityAdminSections.access`, spread in place since E3.3 |
| | AI | `/admin/settings/ai` | `system_settings:read` (until E8.2; now `ai_config:read`, see below) | `pages/admin/AiSettingsPage.tsx`: `AiSettings` (replaced in E8.2 by the packaged `AiConfigPage`); the card that switches AI on, so no `feature` |
| | Backups | `/admin/settings/backups` | `system_settings:read` | `pages/admin/BackupSettingsPage.tsx`: `ScheduledBackups` (schedule and run history) |
| `ADMIN_SECTIONS`, Operations | Maintenance | `/admin/settings/maintenance` | `system_settings:read` (platform maintenance controller default) | packaged `MaintenancePage` (`@marinoscar/platform-web/host/ui`) |
| | Doctor | `/admin/settings/doctor` | `system_settings:read` (`DoctorModule` default) | packaged `DoctorPage`; the card is `doctorSettingsPage.card` |
| | About | `/admin/settings/about` | `system_settings:read` (platform about controller default) | packaged `AboutPage` |
| `USER_SETTINGS_SECTIONS`, Account | Profile | `/settings/profile` | `user_settings:read` | `pages/settings/ProfileSettingsPage.tsx`: Vault's `ProfileSettings` (Vault's `/api/user-settings` is not the platform's shape yet, so not the packaged `UserProfilePage`) |
| | Appearance | `/settings/appearance` | `user_settings:read` | `pages/settings/AppearanceSettingsPage.tsx`: `ThemeSettings`, three equal buttons that stack icon over label below 600px |
| | Access Tokens | `/settings/tokens` | none (the platform's `pat.controller.ts`, bare `@Auth()`) | packaged `UserTokensPage`; the card is `identityUserSettingsSections.security`, spread in place since E3.3 |
| `USER_SETTINGS_SECTIONS`, Data | My backups | `/settings/backups` | `secrets:read` | `pages/settings/MyBackupsPage.tsx`: `DataBackup` with `BackupRunsTable` |
| | Secret types | `/settings/secret-types` (`/new`, `/:id/edit`) | `secret_types:read` | the existing secret types pages, breadcrumbs rooted at Settings |

**As built (E7.2, follow-up to [#85](https://github.com/marinoscar/vault/issues/85)).** The platform email and notifications slices' web side. The cards are APPENDED as new sections (never inserted), each a packaged page, writes gated inside it:

| Registry | Card | Route | `permission` | Page |
|---|---|---|---|---|
| `ADMIN_SECTIONS`, Messaging | Email | `/admin/settings/email` | `system_settings:read` (platform `email-settings.controller` `GET /api/email-settings`); save and test-send `system_settings:write` | packaged `EmailSettingsPage` (`@marinoscar/platform-web/email/ui`) |
| | Web Push | `/admin/settings/push` | `push:read` (platform `push-config.controller` `GET /api/admin/push-config`); generate, rotate, enable, remove `push:write` | packaged `PushConfigPage` (`/notifications/ui`) |
| | Broadcasts | `/admin/settings/broadcasts` | `broadcasts:read` (platform `broadcasts.controller`, which admits `broadcasts:read` or `org_broadcasts:read`; Vault is single-organization and only `admin` holds either, so the card names the system string); compose, cancel, test-send `broadcasts:write` | packaged `BroadcastsPage` |
| `USER_SETTINGS_SECTIONS`, Notifications | Notifications | `/settings/notifications` | `user_settings:read` (the page reads the caller's preferences from `GET /api/user-settings`; saving needs `user_settings:write`; the event and channel registries are bare `@Auth()`) | packaged `UserNotificationsPage` (per-event, per-channel matrix) |

**As built (E8.2, [#88](https://github.com/marinoscar/vault/issues/88)).** The platform AI slice's web side replaces Vault's AI page (`components/settings/AiSettings.tsx`, the verify call and the key form are deleted). The AI card is changed in place; AI models and AI usage are APPENDED at the end of Administration, beneath the AI route at the paths the packaged pages link to (`settingsRegistry.test.ts` allows exactly these two nested card paths):

| Registry | Card | Route | `permission` | Page |
|---|---|---|---|---|
| `ADMIN_SECTIONS`, Administration | AI | `/admin/settings/ai` | `ai_config:read` (platform `ai-admin.controller` `GET /api/admin/ai/config`); policy, keys and limits need `ai_config:write` | `pages/admin/AiSettingsPage.tsx`: packaged `AiConfigPage` (`@marinoscar/platform-web/ai/ui/config-page`; switch AI on, key policy, the OpenAI provider and its write-only key, limits) with Vault's `components/settings/CardScanModelSection.tsx` in its `AfterContent` slot: a select of the enabled models that declare `responses`, `structured_output` and `vision_input` (`GET /api/admin/ai/models?enabled=true&capability=vision_input`), saved as `PATCH /api/system-settings` `{ ai: { cardExtractModel } }` with `If-Match` (`system_settings:write`; read-only without it, hidden without `system_settings:read`). No `feature`: it is where AI is switched on |
| | AI models | `/admin/settings/ai/models` | `ai_config:read` (`GET /api/admin/ai/models`); enabling a model, refreshing the catalogue and per-model limits need `ai_config:write` | packaged `AiModelsPage`; `feature: 'ai'`, route also behind `RequireAiEnabled` |
| | AI usage | `/admin/settings/ai/usage` | `ai_config:read` (`ai-usage-admin.controller` `GET /api/admin/ai/usage`) | packaged `AiUsagePage` (by user, model, provider, key source or feature: `card_extract` is "Card scanning"); `feature: 'ai'`, route also behind `RequireAiEnabled` |

- **Wiring.** `platform/aiConfig.tsx` (`VaultAiConfigProvider`) mounts the platform `AiConfigContext` above the platform host, fetching `GET /api/ai/config` only once signed in; `config/settingsFeatures.ts` registers the `ai` feature from it and `platform/platformHost.tsx` answers `viewer.isFeatureEnabled('ai')` from it. `AiWebAdaptersProvider` hands the AI pages Vault's `LoadingSpinner` (`platform/aiAdapters.ts`). The Console gate gains `ai_config:read`.
- **Card scanning.** The scan entry points (Cards, Home, `/cards/import`) need AI on, `card_extract` usable (`GET /api/ai/status`) and the viewer's `ai:use` (`useAiStatus`), so a Viewer never sees them. The import gate and `describeCardExtractionError` distinguish "AI is off — an admin can turn it on in Console → AI" (`403`, `details.reason: 'AI_DISABLED'`), "AI is not set up yet" (`503 AI_NOT_CONFIGURED`) and a `403` without `ai:use`; the Console link is shown only to a holder of `ai_config:read`. Extraction never returns a security code (`cvv` and `security_code_2` are always null) and the review form never seeds one.

**As built (E6.1 web follow-up, [#84](https://github.com/marinoscar/vault/issues/84)).** Since E6.1 object storage is runtime configuration of the platform storage slice ([runbook](../runbooks/storage-config-migration.md)). The Storage card is APPENDED at the end of Administration:

| Registry | Card | Route | `permission` | Page |
|---|---|---|---|---|
| `ADMIN_SECTIONS`, Administration | Storage | `/admin/settings/storage` | `storage_config:read` (platform `storage-config.controller` `GET /api/admin/storage-config`; deliberately not `storage:read`, which gates object access); saving, the connection test and Create bucket need `storage_config:write`, gated inside the page | packaged `StorageConfigPage` (`@marinoscar/platform-web/storage/ui`, lazy; no adapters, it reads the platform host): driver (Amazon S3, Cloudflare R2, S3-compatible), bucket, region, endpoint, access key id, the write-only secret access key, test connection, Create bucket, the typed `SWITCH` confirmation. No `feature`: it is where storage is set up |

- **Hints.** The "Object storage is not configured" warning on the Backups card (`ScheduledBackups`) and the "Saving to storage isn't set up" helper on My backups (`DataBackup`) end with a link "Set up storage in Console → Storage" (`components/common/StorageSettingsLink.tsx`), rendered only for a holder of `storage_config:read`; anyone else reads the hint alone.
- **Console gate.** The hub gate and the `console` destination's `anyPermission` gain `storage_config:read`.

 `anyPermission` and the `/admin/settings` route gate are `system_settings:read`, `users:read`, `push:read`, `broadcasts:read`, (E8.2) `ai_config:read` and (E6.1) `storage_config:read`, so every Console card is reachable by a holder of its own permission.
- **Notification centre.** `platform/notifications.ts` calls `configureNotificationsWeb({ api, apiBaseUrl, connectSse })` once (imported by `main.tsx`); `components/common/Layout.tsx` wraps the shell in `NotificationProvider` and puts `NotificationBell` in `ShellAppBar`'s `actions` slot, at every width. The bell's popover is the inbox (unread badge and count in its accessible name, mark one or all read, live over SSE). There is no separate inbox page.
- **Not yet.** The admin `Notifications` policy page (`NotificationSettingsPage`, the deployment kill switch) is not wired; Web Push delivery needs the slice's service-worker handlers in a built worker, and Vault's `public/sw.js` is a plain file, so the shell does not run `usePushSubscriptionSync` or show `NotificationPermissionBanner` yet ([local-exceptions](../platform-adoption/local-exceptions.md)).

- **Routes.** Every card route in `App.tsx` is wrapped in `RequirePermission` with exactly the card's permission (admin cards fall back to `/`, user cards to `/settings`); the Console hub is gated on `system_settings:read` or `users:read` (plus `push:read` and `broadcasts:read` since E7.2), the same `anyPermission` as the `console` destination; `/settings` itself is ungated. Redirects keep old URLs: `/admin` and `/admin/users` to their Console routes, `/secret-types`, `/secret-types/new` and `/secret-types/:id/edit` to their pages under the Secret types card.
- **Shell.** `config/shell.ts` lists both hubs as `settingsSurfaces`, so the compact AppBar shows the card title and a back arrow on every card page of either hub; Console mode lists the seven admin cards. The packaged pages read the platform host from `platform/platformHost.tsx` (since E3.3: `createPlatformApiClient` over Vault's `PlatformHttpClient`, the packaged `useAuth` / `usePermissions` as the viewer).
- **Dropped.** "Advanced (JSON)" and `SystemSettingsEditor` are gone; `PUT /api/system-settings` stays in the API. `SecretTypesLink` is replaced by the Secret types card.
- **Phone.** Since E3.3 the users, allowlist and token lists are the packaged identity pages over the platform `DataTable` (a card list below its container breakpoint). No page scrolls sideways at 390px, but the user and allowlist cards truncate the email (`person....`) where Vault's E10.3 table broke it after the `@`: a platform gap recorded as a seam-request candidate, not forked.
- **Home.** `components/home/homeLinks.ts`: "Back up now" goes to `/settings/backups`, "Open backup settings" to `/admin/settings/backups`.
- **Tests.** `__tests__/config/settingsRegistry.test.ts` (cards routed once under their hub, permission declared in `roles.constants.ts` and equal to a controller mirror, each card route gated on exactly that permission, every settings route owned by a card, AI cards' `feature`, redirects, surfaces); `__tests__/pages/SettingsHubPages.test.tsx` (cards per permission, drill-down); `__tests__/SettingsRoutes.test.tsx` (redirects, gates and the packaged pages calling the API with the bearer through the real `App`); one test file per split page.

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

**As built (E10.5, #96).**

- **Gallery** (`pages/CardsPage.tsx`, `components/cards/CardTile.tsx`): a header with the summary line ("5 cards — 1 expired, 1 expiring soon.") and two actions, **Scan a card** (gated on `GET /api/ai/status`, hidden while AI is off) and **Add manually** (`/secrets/new`); a toolbar with search (name, network, holder, bank) and filter chips **All / Needs attention / Expiring soon / Expired** (`aria-pressed`, counts over the whole wallet; `unknown` cards appear only under All). The filter lives in the URL as `?filter=all|attention|expiring_soon|expired` (`expiring` is accepted; `all` drops the parameter), kept in sync with `replace` so the Home dashboard's "needs attention" links (`/cards?filter=attention`) open the filtered gallery; then the grid (`xs=12 sm=6 md=4`). Each tile is a card face at the ISO card aspect ratio in the brand colour (light: a `primary.dark` to `primary.main` gradient with white text; dark: a tonal primary over `paper` with `text.primary`; an expired card turns slate) carrying the user's name for the card, network · kind · bank, the masked number (last four only), cardholder and expiry; under it the `CardExpiryBadge` and **Renew** (contained when the card needs attention, error-coloured when expired). Empty wallet: an amber-fill glyph, "No cards yet", **Scan a card** and **Add manually**. The page adds no gutters of its own (`Container disableGutters`): the shell's `<main>` pads it, so nothing is padded twice on a phone and nothing overflows at 390px.
- **Badge states** (`CardExpiryBadge`): `valid` an outlined success chip; `expiring_soon` the amber accent **fill** with slate text (`secondary`, 7.28:1); `expired` a filled error chip; `unknown` a neutral outline. Each keeps its own icon and words.
- **Import and renew** share one stepper, **Capture → Crop → Review → Save** (`components/cards/CardFlowStepper.tsx`; `aria-current="step"` on the active step; renew marks Crop "Skipped" when no photo was taken). Capture is camera-first (`capture="environment"`) with a secondary **Choose a photo** for the library, full-width buttons on a phone and a card-shaped frame with corner guides. `AiEgressNotice` sits above the camera button on both photos (renew shows the "not read automatically" notice instead while AI is off). Crop is its own step after the read (the AI's box or the auto-fit, adjustable); Review shows a compact strip of the crops to be stored with **Change crop**, marks every value the AI supplied with an **AI** chip (dropped as soon as the user edits it) and low-confidence ones with an amber **Check** chip, and on renew keeps the per-field diff. The API contracts are unchanged.
- **The CVV is manual only.** Neither `toReviewValues` (import) nor `toRenewalValues` (renew) seeds `cvv` or `security_code_2` from the extraction, even when the provider's response carries one (`MANUAL_ONLY_CARD_FIELDS` in `hooks/useCardImport.ts`); renew never carries the old card's code forward either, and a hand-typed code never counts toward `aiAssisted`. Saving stays blocked until the CVV is typed. Tests: `__tests__/pages/{CardsPage,ImportCardPage,RenewCardPage}.test.tsx`, `__tests__/components/cards/{CardExpiryBadge,CardFlowStepper,CardReviewForm}.test.tsx`, `__tests__/hooks/{useCardImport,useCardRenewal}.test.ts`.

**As built (card summary, [#118](https://github.com/marinoscar/vault/issues/118)).** The gallery no longer requests `/secret-types`, `/secrets?typeId=<Card>` and one `/secrets/:id` per card. `useCards` reads `GET /api/secrets/cards/summary?page=N&pageSize=100` (`getCardSummaries` in `services/api.ts`) page after page until `totalPages` (bounded at 50 pages; beyond that the "Showing the first N of M cards" notice appears). Each row is `{ id, name, last4, expMonth, expYear, network, kind, issuingBank, cardholderName, hasPhotos, updatedAt }`, decrypted server-side, sorted soonest expiry first with unknown expiry last; the browser never receives the full number or the CVV. The tile keeps the facts above: the card's name, network · kind · bank (anything restating the name dropped), `•••• last4`, cardholder, expiry, badge, the "Has card photos" icon (`hasPhotos`) and Renew; search matches name, last four, network, issuing bank and cardholder. A null network, kind, bank or cardholder is simply omitted (no subheading part, no Cardholder label, no dash); a null `last4` or expiry renders `•••• —` and `—` with the `unknown` badge, since those are the facts the tile is for. Tests: `__tests__/pages/CardsPage.requests.test.tsx` (real hook over MSW: one summary request for a wallet up to 100 cards, two for 150, no detail request; tile facts; null fields), `__tests__/pages/CardsPage.test.tsx` (heading, subheading, photo icon, search over every field, omitted nulls), `__tests__/hooks/useCards.test.ts`.

## 9. Home dashboard

Replaces the stats/quick-actions/recent mix with three urgency-first panels (each hides if the user lacks its permission):

| Panel | Source | Gate |
|---|---|---|
| Expiring cards | cards with `expired` or `expiring_soon`, soonest first, link to renew | `secrets:read` |
| Recent secrets | `GET /api/secrets?sortBy=updatedAt` (names and types only) | `secrets:read` |
| Last backup status | `GET /api/backups/me` (own) and, for admins, `GET /api/admin/backups` (latest run, status, size, age); a failed or stale (> schedule interval) run shows an error state with a link to the Backups card | `secrets:read`; admin part `system_settings:read` |

Also a compact "Recent media" strip (`media:read`) and quick actions (New secret, Scan card, Upload) gated by `secrets:write` / `media:write`. On first run with no secrets, a single empty-state call to action.

**As built (E10.6, [#97](https://github.com/marinoscar/vault/issues/97)).** `pages/HomePage.tsx` composes `components/home/`: `WelcomeHeader` (greeting, subtitle, the quick actions beside it from 600px and under it on a phone), `StatsRow` (Secrets, Cards, Need attention, Media folders, each a link), `ExpiringCardsPanel` ("Cards needing attention": `expired` and `expiring_soon` only, soonest first, at most 5 rows, `•••• 4242 · Exp MM/YY` plus `CardExpiryBadge`; a writer's row opens `/cards/:id/renew`, a reader's the detail; the header links to `/cards?filter=attention`), `RecentSecretsPanel` (5 rows: name, type, age; links to the detail), `BackupStatusPanel` (your newest saved backup with "Back up now"; for `system_settings:read` the newest scheduled run and the schedule, with failed and overdue (next run more than an hour late) stated in words and a link to the backup settings), `QuickActions` (New secret `secrets:write`; Scan a card `secrets:write` and `GET /api/ai/status` card extraction on; Back up now `secrets:read`) and `FirstRunPanel`. Settings targets live in `components/home/homeLinks.ts` (`/settings` and `/admin/settings` until E10.3 adds the backup cards).

- **Independent sources.** Each panel owns one `useDashboardResource` (`hooks/useDashboardResource.ts`): all start on mount in parallel, each has its own skeleton, empty state and error with "Try again", and a disabled source (missing permission) issues no request. Expiring cards reuse `useCards`.
- **Requests per visit** (asserted in `__tests__/pages/HomePage.test.tsx`): `GET /secrets?pageSize=5&sortBy=updatedAt` (also the Secrets count), one `/secrets/cards/summary?page=1&pageSize=100` (#118; the Cards count is its `totalItems`), `/backups/me?pageSize=1`, `/media/folders?pageSize=1` (count), `/ai/status` (writers only), and for administrators `/admin/backups?pageSize=1` with `/admin/backups/schedule`. No `/secrets/:id` request is made: the per-card fan-out (formerly `/secret-types` + `/secrets?typeId=<Card>` + one detail per card) is gone. Home loads with `useCards` scope `attention`: because the summary is sorted soonest expiry first, expired and expiring cards are a prefix, so it stops after the first page whose last row is `valid` or has no year (a second page only when more than 100 cards need attention). A row's line is `•••• last4 · Exp MM/YY`, with `—` for a value the summary could not read.
- **Dropped:** the Secret types chip panel and the Recent media strip (the media count stays in the stats row); Upload is not a quick action.
- **Layout.** `Container maxWidth="lg" disableGutters` (the shell's `<main>` pads); one column on a phone ordered cards, recent, backups (`display: contents` columns with `order`), two columns (7:5) from `md`. No breakpoint is read in JS.

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
| E10.3 (#94, done) | Settings hub: `adminSections.tsx`, `userSettingsSections.tsx`, move existing settings content into cards, redirect old routes, registry tests | E4, E10.2 |
| E10.4 (#95, done) | Secrets list on datatable with card mode, URL state, version history drawer with diff and rollback, detail and form redesign | E10.2 |
| E10.5 (#96, done) | Cards gallery and expiry statuses; capture → crop → review → save polish for import and renew; CVV manual only | E10.2 |
| E10.6 (#97, done) | Home dashboard (expiring cards, recent secrets, last backup status) | E10.2, E5 for job-based backup status |
| E10.7 | Accessibility pass, Playwright e2e and visual baselines, docs update | E10.1 to E10.6 |

E10.1 is #92 and E10.2 is #93; the other numbers are assigned as each starts.
