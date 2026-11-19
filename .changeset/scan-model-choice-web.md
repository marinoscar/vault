---
"@marinoscar/vault-web": minor
---

`ScanModelsSection` replaces the card-only model picker on the AI page (#213): a "Card scanning model" and a "Document scanning model" (with "Same as card scanning") picker, listing the models of every enabled provider that can scan, OpenAI-compatible included, and read-only without `ai_config:write`. `useAiStatus` derives `cardExtractEnabled` and `documentScanEnabled` from the shared `isScanAvailable` rule over `GET /api/ai/config` and `GET /api/secrets/scan/targets`, failing closed. `useSystemSettings` gains `updateDocumentExtractModel`; `CardScanModelSection`, `cardScanCandidates`, `CARD_EXTRACT_NEEDS` and `isCardScanAvailable` stay as deprecated aliases for one release.
