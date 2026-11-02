---
name: add-settings-page
description: Add an admin or per-user settings page to the Vault web app as a registry card - the entry in adminSections.tsx or userSettingsSections.tsx, the exact permission string the API controller enforces, reuse of SettingsHub, the route, feature gates and the registry tests. The registries exist since E10.3. Use when adding any settings screen, admin Console page or per-user preference page.
---

# Add a settings page

> **The registries exist since E10.3 (#94)**: `apps/web/src/config/adminSections.tsx` (`ADMIN_SECTIONS`, the Console hub `/admin/settings` and rail) and `userSettingsSections.tsx` (`USER_SETTINGS_SECTIONS`, the `/settings` hub). Spec: `docs/specs/ux-refresh.md` section 6 (with the as-built card table). Rationale originates in EAB `docs/specs/settings-ui.md`.

## Steps

1. Write the page component. Gate writes inside the page by disabling controls, not with a second card permission.
2. Append ONE card to the registry (admin: `ADMIN_SECTIONS`; per-user: `USER_SETTINGS_SECTIONS`), never inserted between existing cards: `{ title, description, Icon, path?, disabled?, permission?, feature?, alwaysShow? }`. `Icon` is a component, not an element.
3. Add the route beside the other `/admin/settings/*` or `/settings/*` routes in `App.tsx`, as `<Route path="..." element={<RequirePermission permission="<the card's permission>" fallback={TO_HOME | TO_SETTINGS}>...` (path and gate adjacent; the registry test reads them). A card with no permission gets an ungated route. A route without a card is unacceptable. A card may sit under another card's path (`/admin/settings/ai/models` under `/admin/settings/ai`) only when the packaged page of the parent links to it; the registry test allows exactly the two AI cards (Models, Usage) and nothing else. Wrap the page in `components/settings/SettingsPageFrame.tsx` (title = card title). `RequirePermission` is the packaged guard (`@marinoscar/platform-web/identity/headless`). A packaged platform page reads the host from `platform/platformHost.tsx`.
4. API calls go through `apps/web/src/services/api.ts`, wrapped in a hook.
5. Update `apps/web/src/__tests__/config/settingsRegistry.test.ts` (its controller mirror and the card order) and add a test for the page.

## Rules

- **Never a new tab on a settings page.** Tabs only for parallel content in one destination.
- **`permission` is the exact string the controller enforces.** Vault's: `system_settings:read`/`write` (system settings, AI config and verify, admin backups), `users:read` (`users.controller.ts`), `allowlist:read` (`allowlist.controller.ts`; gates content inside the Users page, not the route), `secret_types:read`/`write` (`secret-types.controller.ts`), `secrets:read` (My backups, `my-backups.controller.ts`), `user_settings:read`/`write` (`user-settings.controller.ts`), `media:read`. Platform pages (identity, storage, AI, jobs) take the permission from the installed platform controller; read it there.
- AI cards declare `feature: 'ai'` so they hide while AI is off; the card that switches AI on carries none. Never put a provider key or provider call in the browser.
- Reuse the packaged `SettingsHub` (`@marinoscar/platform-web/settings/ui`) as a 4-prop binding (`sections`, `hubKey`, `title`, `subtitle`); never fork it.
- The five breakpoint gates (`ShellLayout` `showRail` and `<main>` `pb`, `ShellBottomNav`, `SettingsHub`, `ShellAppBar`; all at `sm`) move together or not at all; do not touch them for a normal page.
- Runtime-configured features get an admin card, never an environment variable.

## Verify

`cd apps/web && npm run typecheck && npm run typecheck:test && npm run test:run`; check phone width (<600px) and desktop, light and dark. Delegate to `frontend-dev`, then `testing-dev`; flag the card to `docs-dev` for the settings inventory in `docs/specs/ux-refresh.md`.
