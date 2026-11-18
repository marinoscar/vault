---
'@marinoscar/vault-web': minor
---

Add authenticator codes (TOTP) to Credential secrets: the form validates a pasted `otpauth://` link or base32 key (and shows the API's field error), and the detail page has an "Authenticator code" card that fetches the code on demand (`POST /secrets/:id/totp`), shows it grouped with a countdown ring and a copy button, and refreshes it on expiry. New `getSecretTotp`, `useTotpCode`, `groupTotpCode`, `TotpCodeCard`, `TOTP_FIELD_NAME`, `fieldErrorsFromApiError`.
