---
'@marinoscar/vault-web': minor
---

Add the "Scan an ID" flow (issue #211): the `documents` slice (`./documents/headless`: `useDocumentScan` and its helpers; `./documents/ui`: `DocumentReviewForm`, `DocumentScanPage` at `/documents/scan?type=passport|id_document`), `extractDocument`, `isDocumentScanAvailable` and a live `useAiStatus().documentScanEnabled`, the shared `describeScanError` and `useSaveSecretWithImages` in `core/headless`, slot, ratio and wording props on the card capture, crop, stepper and egress components (card defaults unchanged), `flaggedKeys` on `KeyValueFieldEditor` (`keyValueFlags` on `DynamicSecretFields`), the Home "Scan an ID" quick action, the Secrets list button for Passport and ID Document, `?type=` preselect on the new-secret page, and `/documents` owned by the Secrets destination.
