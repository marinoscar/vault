---
'@marinoscar/vault-web': minor
---

Identity-document expiry on the web (IDOC-9). New subpaths `@marinoscar/vault-web/documents/headless` (`useDocumentSummary`, `isDocumentNeedingAttention`) and `@marinoscar/vault-web/documents/ui` (`DocumentExpiryBadge`); `getDocumentSummary` in `core/headless`. Home shows `ExpiringDocumentsPanel` next to the cards panel, hidden when no document needs attention, each row linking to the secret; the secret detail page shows the expiry badge for Passport and ID Document secrets.
