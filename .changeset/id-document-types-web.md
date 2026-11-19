---
'@marinoscar/vault-web': minor
---

Identity documents (issue #209): `SecretTypeIcon` knows the `Badge`, `TravelExplore` and `AssignmentInd` icons. `useAiStatus` gains `documentScanEnabled` (always `false` until the document scan ships, issue #211); while it is true, `SecretForm` shows a "Scan it instead" link to `/documents/scan?type=passport|id_document` for the Passport and ID Document types. `SecretForm` hands `DynamicSecretFields` a new `suggestions` prop: for an ID Document, the catalog's standard `attributes` keys of the chosen `document_kind`, for the key/value editor. New helpers in `secrets/headless`: `PASSPORT_TYPE_NAME`, `ID_DOCUMENT_TYPE_NAME`, `documentScanTypeParam`, `documentScanPath`, `keyValueSuggestionsFor` and the `KeyValueSuggestion` type.
