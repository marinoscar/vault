---
'@marinoscar/vault-contract': minor
---

Identity-document expiry (IDOC-9) in `@marinoscar/vault-contract/secrets`: `documentExpiryLeadDays(typeName, documentKind)` (Passport lead days, the catalog kind's, `Other` for an unknown kind), `parseDocumentDate`, `daysUntilDate` (UTC calendar days), `documentExpiryStatus` (`expired`, `expiring_soon` within the kind's largest lead day, `valid`, `no_expiry`), `EXPIRING_DOCUMENT_TYPE_NAMES`, and the wire shape of `GET /api/secrets/documents/summary` (`documentSummaryItemSchema`, strict: no number, date of birth or holder name; `documentSummaryResponseSchema`).
