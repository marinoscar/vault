---
'@marinoscar/vault-api': minor
---

Identity-document expiry reminders (IDOC-9). New subpath `@marinoscar/vault-api/document-expiry`: the server-only job `vault.documents.expiry_scan` (permanent type; 15 minutes, 2 attempts), its enqueue-only daily tick `DocumentExpiryTask` (05:43 UTC), and the pure `daysUntilDate`, `leadDaysFor` and `dueThreshold`. The scan reads only `expiry_date` and `document_kind` of Passport and ID Document secrets of active owners, notifies once per (document, expiry, lead day) through the new event `vault.document_expiring` (template `vault-document-expiring`, payload `VaultDocumentExpiringNotificationData`: id, name, label, expiry, days left, threshold; never a number, date of birth or holder name) and records the audit row `vault.document.expiry_notified` as the dedup record. New route `GET /api/secrets/documents/summary` (`secrets:read`, the caller's own documents) served by `DocumentSummaryService`.
