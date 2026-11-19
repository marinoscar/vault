---
'@marinoscar/vault-api': patch
---

Internal refactor (#204): extract a scan-profile registry from card scanning. New experimental exports on `@marinoscar/vault-api/ai`: `ScanProfile`, `ScanImageSlot`, `ScanProfileRegistry` (with `createScanProfileRegistry`), `DocumentScanService`, `ScanCropBox` and `repairBox`, plus `cardScanProfile`. The card is the first registered profile; `CardExtractService` keeps its signature and delegates to `DocumentScanService.extract('card', ...)`. `CardCropBox` is now an alias of `ScanCropBox`. No change to the route, the wire format, the prompt, the `card_extract` feature, the error codes or the metric labels.
