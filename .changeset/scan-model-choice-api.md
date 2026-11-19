---
"@marinoscar/vault-api": minor
---

Scan availability by capability, not vendor (#213): `GET /api/secrets/scan/targets` (`ai:use`) and `ScanTargetsService` report the model each scan feature runs on with its catalogue capabilities, and `isScanAvailable(config, feature, targets)` applies the shared contract rule, so an `openai-compatible` (on-prem) model can scan. `isCardScanAvailable` is a deprecated alias kept for one release.
