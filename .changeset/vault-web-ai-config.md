---
"@marinoscar/vault-web": minor
---

Card scanning availability now comes from the platform's `GET /api/ai/config` instead of the removed `GET /api/ai/status` alias. `useAiStatus` reads it through `useAiConfig` of `@marinoscar/platform-web/ai/headless` (the host's shared copy when one is mounted) and applies the new pure helper `isCardScanAvailable(config)`, the same rule as the API. Its result keeps `cardExtractEnabled`, `canUseAi`, `isLoading`, `error` and `refresh`; `status` is replaced by `config` (the platform's `AiPublicConfig`). Breaking: the exported `getAiStatus` and the `AiStatus` type are removed.
