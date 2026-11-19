---
"@marinoscar/vault-contract": minor
---

Add the scan model choice and availability rule to `/secrets` (#213): `isScanAvailable(input, feature)` decides from the public AI config and the scan targets whether `card_extract` or `document_extract` is usable (AI on, the feature's model an enabled catalogue model declaring `vision_input`, `structured_output` and `responses` on an enabled provider, and a payable call: a keyless OpenAI-compatible server or the deployment key), plus `resolveScanModelRef`, `SCAN_MODEL_NEEDS`, `SCAN_AI_FEATURES` and the `scanTargetsSchema` wire shape of `GET /api/secrets/scan/targets`.
