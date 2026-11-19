# @marinoscar/vault-web

## 0.1.0-next.3

### Patch Changes

- d16fe7b: The package READMEs say how to install from npm (the `next` dist-tag, the peers, provenance) for the first published release (#192). No code change.

## 0.1.0-next.2

### Minor Changes

- 14f844c: Add the `agent` slice (`@marinoscar/vault-web/agent/headless` and `/agent/ui`): the per-user `AgentActivityPage` (what apps did with your logins, filterable, with a link to Connected apps) and the admin `AgentAccessSettingsPage` (the agent API's kill switch and per-minute limits). `SystemSettings` carries `agentAccess`.
- 60b975f: Add per-secret agent access to the secrets UI: an "Allow agents to use this login" switch on the Credential detail page, an "Agents" chip in the list and an "Agent access" filter (`?agent=fill|none`). `SecretListItem` carries `agentAccess` and `agentAccessChangedAt`; new `updateSecretAgentAccess` client and `useSecretDetail().setAgentAccess`.
- d85c2f9: Add authenticator codes (TOTP) to Credential secrets: the form validates a pasted `otpauth://` link or base32 key (and shows the API's field error), and the detail page has an "Authenticator code" card that fetches the code on demand (`POST /secrets/:id/totp`), shows it grouped with a countdown ring and a copy button, and refreshes it on expiry. New `getSecretTotp`, `useTotpCode`, `groupTotpCode`, `TotpCodeCard`, `TOTP_FIELD_NAME`, `fieldErrorsFromApiError`.
- 2318f0a: Card scanning availability now comes from the platform's `GET /api/ai/config` instead of the removed `GET /api/ai/status` alias. `useAiStatus` reads it through `useAiConfig` of `@marinoscar/platform-web/ai/headless` (the host's shared copy when one is mounted) and applies the new pure helper `isCardScanAvailable(config)`, the same rule as the API. Its result keeps `cardExtractEnabled`, `canUseAi`, `isLoading`, `error` and `refresh`; `status` is replaced by `config` (the platform's `AiPublicConfig`). Breaking: the exported `getAiStatus` and the `AiStatus` type are removed.

### Patch Changes

- 92dae83: vault-api: the `agent` OAuth protected resource (`/api/agent/v1`) with the scopes `vault:items_read`, `vault:items_fill` and `vault:items_write` (`registerVaultAgentOAuth`, `./agent` export), the `secrets:fill` permission and `GET /api/agent/v1/whoami`. vault-web: `/oauth/consent` and `/oauth/error` are unowned routes.
- 1934687: Require `@marinoscar/platform-api`, `@marinoscar/platform-contract` and `@marinoscar/platform-web` `0.1.0-next.37` (peer and dev dependencies). No API change in the Vault packages.
- 7bb426b: The Secrets list's table layout no longer expects a host `DataTablePreferencesProvider`: without one it takes the platform datatable's default port, the `dataTables` namespace of `/api/user-settings` over the host's client (#153). Docs and the test harness follow; no runtime change for a host that still mounts a provider.

## 0.1.0-next.1

### Minor Changes

- 1486f4f: Add `@marinoscar/vault-web`: the Vault domain pages, components, hooks, navigation destinations and brand, moved out of `apps/web` (E12.3, #104).

## 0.1.0-next.0

- Initial version (E12.3, issue 104). The domain pages, components and hooks, the navigation destinations and the brand moved out of `apps/web` without a visual or behaviour change; see the README.
