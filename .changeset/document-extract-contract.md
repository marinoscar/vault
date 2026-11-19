---
'@marinoscar/vault-contract': minor
---

Document scanning wire schemas (issue #210, experimental): `@marinoscar/vault-contract/secrets` adds `SCANNABLE_DOCUMENT_TYPES` (`passport`, `id_document`), `DOCUMENT_SCAN_SLOTS`, `scanImageDataUrlSchema`, `extractDocumentRequestSchema` (passport needs `data_page`, ID document needs `front`), `scanCropBoxSchema`, `scannedAttributeSchema`, `documentCheckResultSchema`, `extractDocumentResponseSchema` and their types, and `MAX_IMAGE_DATA_URL_LENGTH` (moved from vault-api, which re-exports it; value unchanged).
