# @marinoscar/vault-web

The React side of the Vault domain: the pages, components and hooks of secrets, secret types, payment cards, media folders, backups and Home, Vault's own settings card pages, the navigation destinations and the brand (tokens, themes, mark). ESM only, `sideEffects: false`, one subpath per slice. `apps/web` is the host: it routes to these pages, mounts the providers and binds the platform ([ADR-0001](../../docs/decisions/0001-packages-first.md)).

## Purpose and scope

The package holds the domain's user interface written once, so a second host (a desktop edition, a kiosk build) mounts the same pages instead of copying them. It does not hold the shell, the routes, the settings registries or hubs, the identity, AI, telemetry, notification or database-backup bindings, the service worker or the Vite configuration: those are the host's. Platform slices (`DataTable`, `SettingsHub`, identity guards, the AI config page) come from `@marinoscar/platform-web`, never copied here.

Status: experimental. Introduced in E12.3 (issue 104) by moving the domain code out of `apps/web/src` with no visual or behaviour change (the visual baselines are unchanged); `apps/web` imports it from these subpaths.

Entry points (`<slice>/headless` holds hooks, calls and helpers; `<slice>/ui` holds components and pages; pages are named exports, `SecretsPage` and so on):

- `@marinoscar/vault-web`: the root, `VAULT_WEB_PACKAGE` only.
- `@marinoscar/vault-web/core/headless`: `configureVaultWeb` (the HTTP port), the domain calls (`getSecrets`, `getBackupSchedule`, ...), the wire types, `useCopyToClipboard`, `useDashboardResource`, `useAiStatus` (card scanning from the platform's `GET /api/ai/config`) with its pure rule `isCardScanAvailable`, `useSystemSettings`, `useUserSettings`, `saveBlobAsFile`, `formatRelativeTime`.
- `@marinoscar/vault-web/core/ui`: `LoadingSpinner`, `ErrorBoundary`, `SettingsPageFrame`, `StorageSettingsLink`.
- `@marinoscar/vault-web/secrets/headless`, `@marinoscar/vault-web/secrets/ui`: secrets and secret types (list, detail, create, edit, versions, attachments, the type builder and its pages).
- `@marinoscar/vault-web/cards/headless`, `@marinoscar/vault-web/cards/ui`: payment cards (Cards, scan import, renewal, the card-scanning model section and the AI settings page that carries it).
- `@marinoscar/vault-web/media/headless`, `@marinoscar/vault-web/media/ui`: media folders and files.
- `@marinoscar/vault-web/backups/headless`, `@marinoscar/vault-web/backups/ui`: scheduled (admin) and personal backups, the My backups and Backups settings pages.
- `@marinoscar/vault-web/home/headless`, `@marinoscar/vault-web/home/ui`: the Home dashboard.
- `@marinoscar/vault-web/settings/ui`: Vault's General, Profile and Appearance settings card pages.
- `@marinoscar/vault-web/brand`: `BRAND_TOKENS`, `PRODUCT_NAME`, `PRODUCT_TAGLINE`, `VAULT_THEMES`, `vaultLightTheme`, `vaultDarkTheme`, `contrastRatio`, `BrandLockup`, `VAULT_MARK_URL`.
- `@marinoscar/vault-web/brand/assets/vault-mark.png`: the mark image itself.
- `@marinoscar/vault-web/navigation`: `DESTINATIONS`, `DESTINATION_ROUTES`, `UNOWNED_ROUTES`, `owns`, `isDestinationVisible`.

## Install and peer dependencies

```bash
npm install @marinoscar/vault-web@next
```

Everything React and MUI is a peer, so the host keeps one copy of each (two Reacts or two MUI theme contexts break hooks and theming):

| Package | Range | Needed by |
|---|---|---|
| `react`, `react-dom` | `^19.2.7` | every slice |
| `react-router-dom` | `^7.17.0` | pages and navigation |
| `@mui/material`, `@mui/icons-material`, `@mui/utils` | `^9.1.0` / `^9.0.0` | every `ui` subpath and `brand` |
| `@marinoscar/platform-web` | `0.1.0-next.21` | the shell, identity, data table, settings and AI pieces the pages use |
| `@marinoscar/vault-contract` | `>=0.0.0-0 \|\| >=0.1.0-0` | wire constants and types |

The host's bundler must understand an image import (Vite does): `BrandLockup` imports the PNG next to it.

## Quick start

```tsx
// The host, once, before the first render (apps/web/src/services/api.ts).
import { PlatformHttpClient } from '@marinoscar/platform-web/core';
import { configureVaultWeb } from '@marinoscar/vault-web/core/headless';

export const api = new PlatformHttpClient({ baseUrl: '/api', refreshLockName: 'vault-auth-refresh' });
configureVaultWeb({ http: api, apiBaseUrl: '/api' });

// A route (apps/web/src/App.tsx).
const SecretsPage = lazy(() => import('@marinoscar/vault-web/secrets/ui').then((m) => ({ default: m.SecretsPage })));
```

The pages expect what the host mounts above them: a router, `ShellRoot` with `VAULT_THEMES`, the platform identity `AuthProvider` (for `useAuth` / `usePermissions`), a `PlatformHostProvider` and a `DataTablePreferencesProvider`.

## Configuration

`configureVaultWeb({ http, apiBaseUrl? })` is the only configuration. `http` is the host's `PlatformHttpClient` (the same instance the platform's `AuthProvider` drives, so the bearer token and the refresh are shared); `apiBaseUrl` (default `/api`) is read only by the two raw `fetch` calls that stream an attachment. A slice that calls the API before it is configured throws `VaultWebNotConfiguredError`. The package reads no environment or build-time variable.

## Extension-point catalog

| Extension point | Where | What a host varies |
|---|---|---|
| HTTP port | `configureVaultWeb` (`core/headless`) | the transport, base URL and refresh lock |
| Table layout store | the host's `DataTablePreferencesProvider` | where the Secrets list keeps its column, sort and page-size layout |
| Platform host | the host's `PlatformHostProvider` | the viewer, permissions and features the packaged platform pieces read |
| Theme | `VAULT_THEMES` passed to `ShellRoot` | the host may extend or replace the themes |

## Build and test

```bash
npm run build -w @marinoscar/vault-web      # tsc (NodeNext) to dist/, then copies the brand image
npm run typecheck -w @marinoscar/vault-web  # src and test (bundler resolution) plus the NodeNext build check
npm run test:run -w @marinoscar/vault-web   # Vitest + React Testing Library + MSW, jsdom
```

The suites render through `test/utils/test-utils.tsx`, which mounts what the host mounts without importing the host; `test/setup.ts` configures the HTTP port against the MSW handlers in `test/mocks/`.

## Security notes

- The browser never calls an AI provider: card scanning posts to `POST /api/secrets/cards/extract` and shows `AiEgressNotice`; the CVV is never sent, returned or seeded into the review form.
- Secret values come only from the detail view, are copied through `useCopyToClipboard` and are never written to `localStorage`, logs or error reports. Backup passwords live in component state only.
- The UI presents and the API authorizes: a hidden button is not a permission check.

## Links

- [ADR-0001, packages first](../../docs/decisions/0001-packages-first.md)
- [The Vault packages](../../docs/PACKAGES.md)
- [The host's rules](../../apps/web/AGENTS.md)
- [UX refresh spec](../../docs/specs/ux-refresh.md)
- [Changelog](CHANGELOG.md)
