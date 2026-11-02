# apps/web rules

Root rules ([AGENTS.md](../../AGENTS.md)) apply. This file is what to get right when editing the React app. Target UX: [docs/specs/ux-refresh.md](../../docs/specs/ux-refresh.md).

## Layout (today)

- `src/pages/` (HomePage, SecretsPage, SecretDetailPage, Create/EditSecretPage, CardsPage, ImportCardPage, RenewCardPage, SecretTypesPage and editors, Media* pages, SystemSettingsPage, UserSettingsPage, UserManagementPage, LoginPage, auth/device pages), `src/components/` (`admin`, `auth`, `cards`, `common` incl. `Layout.tsx` and `ProtectedRoute`, `device-activation`, `home`, `media`, `navigation` (flat `Sidebar`, `AppBar`, `UserMenu`), `secret-types`, `secrets`, `settings`, `user`), `src/hooks/`, `src/contexts/` (`AuthContext`, `ThemeContext`), `src/services/api.ts`, `src/theme/` (`light.ts`, `dark.ts`, `components.ts`), `src/utils/` (card, backup, clipboard helpers), `src/types/`.
- Routes live in `src/App.tsx`. Tests: `src/__tests__/` (**Vitest** + React Testing Library; `components/`, `hooks/`, `pages/`, `services/`, `utils/`, `mocks/`, `setup.ts`).
- **Target:** identity UI, settings hub, shell, datatable and AI pages come from `@marinoscar/platform-web` (E3 to E10); `src/config/destinations.ts`, `adminSections.tsx`, `userSettingsSections.tsx` are created in E10. Domain pages (secrets, cards, media, backups UI) stay here until E12.

## Rules

- **Settings UI** (root rule; the registry exists from E10): a new settings page is a card appended to a registry, never a new tab of `SystemSettingsPage`/`UserSettingsPage`; a card's `permission` is the exact string the API controller enforces; reuse `SettingsHub`, never fork. Recipe: [`add-settings-page` skill](../../.claude/skills/add-settings-page/SKILL.md).
- **Breakpoint gates**: the five coupled gates all sit at `sm` (600px), never `md`; today `Layout.tsx`, `Sidebar` and `AppBar` hold them; after E10 they are the platform's and the app reads no breakpoint for them.
- **Navigation (E10)**: destinations are declared once in `src/config/destinations.ts` as `ShellDestination`s; Home, Secrets, Cards, Media are non-pinned; Settings and Console are `pinned` (a mode, not a peer); at most **four** bottom-bar tabs. Until then, add a nav item only in `components/navigation/Sidebar.tsx` and keep it to those destinations.
- **The UI presents; the API authorizes.** Hiding a card or button is not security. Gate with `usePermissions` / `RequirePermission` using the same permission strings as the controllers.
- **Never keep secret values longer than needed**: list responses are not decrypted, so values come only from the detail view; copy through `useCopyToClipboard`; never put a value in `localStorage`, logs or error reports. Backup passwords are held in component state only and never persisted.
- **Never call an AI provider from the browser**; card scanning goes through `POST /api/secrets/cards/extract` and shows `AiEgressNotice`. The CVV is never sent.
- Use MUI theming (`src/theme/`) and the responsive layout; no hard-coded colours outside the theme. Brand tokens are specified in `ux-refresh.md`.
- Runtime-configured features (storage, AI, SMTP, VAPID) are admin-UI settings, never build-time variables.
- Write components and hooks with tests; a behaviour change carries its tests in the same or next commit. Tests use invented data (placeholders, test PANs).

Run (from `apps/web`): `npm run test:run`, `npm run typecheck`, `npm run typecheck:test`, `npm run build`.
