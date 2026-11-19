---
'@marinoscar/vault-api': minor
---

Passport and ID document scanning (issue #210, experimental): `POST /api/secrets/documents/extract` (`DocumentExtractController`, `DocumentExtractService`; the card route's guards: `secrets:write` + `ai:use` and the AI kill switch), the `passport` and `id_document` scan profiles (`createPassportScanProfile`, `createIdDocumentScanProfile`) registered by `createScanProfileRegistry` under the new permanent AI feature `DOCUMENT_EXTRACT_FEATURE` (`document_extract`), and the pure normalizer (`normalizePassportScan`, `normalizeIdDocumentScan`) that runs the MRZ, SSN and VIN checks. `VaultMetricsPort` gains `documentExtracted(documentType, outcome)` (implemented by `CountingMetrics`; a host binding the port must add it). `DOCUMENT_EXTRACTION_TYPES` joins the metric labels. A non-card scan logs "Document scan (<id>) unavailable" instead of the card wording. Persists nothing.
