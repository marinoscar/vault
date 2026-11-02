---
name: add-settings-page
description: Add an admin or per-user settings page to the Vault web app as a registry card - the entry in adminSections.tsx or userSettingsSections.tsx, the exact permission string the API controller enforces, reuse of SettingsHub, the route, feature gates and the registry tests. The registry is created in E10; before then follow the rule (own routed page, no new tab). Use when adding any settings screen, admin Console page or per-user preference page.
---

# Add a settings page

> **Registry exists from E10** (`apps/web/src/config/adminSections.tsx`, `userSettingsSections.tsx`, `destinations.ts`). Before E10, settings are tabs (`SystemSettingsPage`, `UserSettingsPage`). The rule applies already: do **not** add a tab; build the content as a standalone component with its own hook so E10 can mount it as a card unchanged. Spec: `docs/specs/ux-refresh.md` (settings hub section). Rationale originates in EAB `docs/specs/settings-ui.md`.

## Steps (after E10)

1. Write the page component. Gate writes inside the page by disabling controls, not with a second card permission.
2. Append ONE card to the registry (admin: `ADMIN_SECTIONS`; per-user: `USER_SETTINGS_SECTIONS`), never inserted between existing cards: `{ title, description, Icon, path?, disabled?, permission?, feature?, alwaysShow? }`. `Icon` is a component, not an element.
3. Add the route beside the other `/admin/settings/*` or `/settings/*` routes in `App.tsx`. A route without a card is unacceptable.
4. API calls go through `apps/web/src/services/api.ts`, wrapped in a hook.
5. Update the registry tests in `apps/web/src/__tests__/config/` (created in E10).

## Rules

- **Never a new tab on a settings page.** Tabs only for parallel content in one destination.
- **`permission` is the exact string the controller enforces.** Vault's: `system_settings:read`/`write` (system settings, AI config and verify, admin backups), `users:read` (`users.controller.ts`), `allowlist:read` (`allowlist.controller.ts`; gates content inside the Users page, not the route), `secret_types:read`/`write` (`secret-types.controller.ts`), `secrets:read` (My backups, `my-backups.controller.ts`), `user_settings:read`/`write` (`user-settings.controller.ts`), `media:read`. Platform pages (identity, storage, AI, jobs) take the permission from the installed platform controller; read it there.
- AI cards declare `feature: 'ai'` so they hide while AI is off; the card that switches AI on carries none. Never put a provider key or provider call in the browser.
- Reuse the packaged `SettingsHub` (`@marinoscar/platform-web/settings/ui`) as a 4-prop binding (`sections`, `hubKey`, `title`, `subtitle`); never fork it.
- The five breakpoint gates (`ShellLayout` `showRail` and `<main>` `pb`, `ShellBottomNav`, `SettingsHub`, `ShellAppBar`; all at `sm`) move together or not at all; do not touch them for a normal page.
- Runtime-configured features get an admin card, never an environment variable.

## Verify

`cd apps/web && npm run typecheck && npm run typecheck:test && npm run test:run`; check phone width (<600px) and desktop, light and dark. Delegate to `frontend-dev`, then `testing-dev`; flag the card to `docs-dev` for the settings inventory in `docs/specs/ux-refresh.md`.
