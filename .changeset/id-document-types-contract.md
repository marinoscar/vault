---
'@marinoscar/vault-contract': minor
---

Identity documents (issue #209, experimental): `SYSTEM_SECRET_TYPES` appends the system types `Passport` (icon `TravelExplore`) and `ID Document` (icon `AssignmentInd`), both with attachments. `@marinoscar/vault-contract/secret-types` adds the document-kind catalog: `ID_DOCUMENT_KINDS`, `IdDocumentKind`, `DOCUMENT_CHECK_IDS`, `DocumentCheckId`, `StandardAttributeKey`, `IdDocumentKindSpec`, `ID_DOCUMENT_KIND_CATALOG` (standard `attributes` keys, checks and expiry lead days per kind), `PASSPORT_EXPIRY_LEAD_DAYS`, `isIdDocumentKind` and `standardAttributeKeysFor`.
