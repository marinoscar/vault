# @marinoscar/vault-web

## 0.1.0-next.2

### Minor Changes

- 2318f0a: Card scanning availability now comes from the platform's `GET /api/ai/config` instead of the removed `GET /api/ai/status` alias. `useAiStatus` reads it through `useAiConfig` of `@marinoscar/platform-web/ai/headless` (the host's shared copy when one is mounted) and applies the new pure helper `isCardScanAvailable(config)`, the same rule as the API. Its result keeps `cardExtractEnabled`, `canUseAi`, `isLoading`, `error` and `refresh`; `status` is replaced by `config` (the platform's `AiPublicConfig`). Breaking: the exported `getAiStatus` and the `AiStatus` type are removed.

### Patch Changes

- 7bb426b: The Secrets list's table layout no longer expects a host `DataTablePreferencesProvider`: without one it takes the platform datatable's default port, the `dataTables` namespace of `/api/user-settings` over the host's client (#153). Docs and the test harness follow; no runtime change for a host that still mounts a provider.

## 0.1.0-next.1

### Minor Changes

- 1486f4f: Add `@marinoscar/vault-web`: the Vault domain pages, components, hooks, navigation destinations and brand, moved out of `apps/web` (E12.3, #104).

## 0.1.0-next.0

- Initial version (E12.3, issue 104). The domain pages, components and hooks, the navigation destinations and the brand moved out of `apps/web` without a visual or behaviour change; see the README.
