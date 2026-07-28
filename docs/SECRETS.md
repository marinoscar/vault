# Secrets

This document describes the secrets management feature of the Vault application: how secrets are encrypted, versioned, and accessed; how secret types are defined; and what operators need to configure and secure the system.

## Table of Contents

- [Overview](#overview)
- [Configuration](#configuration)
- [Encryption](#encryption)
- [Secret Types](#secret-types)
- [Versioning](#versioning)
- [Rollback](#rollback)
- [Attachments](#attachments)
- [API Reference](#api-reference)
- [RBAC Permissions](#rbac-permissions)
- [Data Validation](#data-validation)
- [Audit Trail](#audit-trail)
- [Frontend](#frontend)
- [Security Considerations](#security-considerations)

---

## Overview

The secrets feature provides encrypted storage for sensitive data such as credentials, API keys, payment cards, tokens, and notes. Each secret belongs to a typed schema that defines which fields exist and which are sensitive. Every data change creates a new immutable version, and any version can be restored via rollback. File attachments are supported for secret types that allow them.

---

## Configuration

```bash
# REQUIRED -- encryption key for all secret data
# Generate: openssl rand -hex 32
VAULT_ENCRYPTION_KEY=<64-character-hex-string>

# For file attachments (optional)
STORAGE_PROVIDER=s3
S3_BUCKET=your-bucket
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

# Card face image size cap in bytes (optional, default 5 MB = 5242880)
# Applies only to card_front / card_back attachments. A non-numeric or
# non-positive value is ignored (falls back to the default) rather than
# disabling the check.
CARD_IMAGE_MAX_BYTES=5242880
```

AI card scanning is configured entirely through **system settings** (`ai.enabled`, `ai.model`, `ai.maxCallsPerUserPerDay`, `ai.apiKey`), not environment variables — there is no `OPENAI_API_KEY` env var. See [Security Considerations](#security-considerations) and [API.md](API.md#ai-card-extraction).

`VAULT_ENCRYPTION_KEY` must be a 64-character hexadecimal string representing 32 bytes. The application validates this on startup and will refuse to start if the key is absent or the wrong length.

---

## Encryption

**Algorithm:** AES-256-GCM

**Key:** 32 bytes derived from `VAULT_ENCRYPTION_KEY` (provided as a 64-character hex string).

**Per-version IV:** Each secret version is encrypted with a randomly generated 12-byte initialization vector (`crypto.randomBytes(12)`). The IV is never reused across versions or rollbacks.

**Storage format:** Three values are stored as base64 strings in the database per version:
- `iv` — the 12-byte IV
- `encryptedData` — the ciphertext
- `authTag` — the 16-byte GCM authentication tag

The authentication tag guarantees that tampered ciphertext is detected on decryption rather than silently producing corrupt data.

**Implementation:** `apps/api/src/common/services/crypto.service.ts`

The `CryptoService` validates the key length during module initialization and throws immediately if misconfigured, so misconfiguration fails fast rather than at runtime.

**Key rotation:** There is no key rotation mechanism in the current implementation. All data is encrypted with the same static key. Key rotation is planned for a future release.

---

## Secret Types

Secret types define the schema of a secret's data fields. There are two categories: system types and custom types.

### System Types

Six system types are created during database seeding. They cannot be modified or deleted. Source of truth: `apps/api/prisma/system-secret-types.ts`.

| Type | Icon | Fields | Attachments |
|------|------|--------|-------------|
| Credential | Key | `username`, `password` (sensitive), `url`, `notes` | No |
| API Key | VpnKey | `key` (sensitive), `provider`, `notes` | No |
| Card | CreditCard | `card_network` (select, optional), `card_kind` (select, optional), `cardholder_name`, `number` (sensitive), `exp_month`, `exp_year`, `cvv` (sensitive), `security_code_2` (sensitive, optional), `issuing_bank` (optional), `notes` | **Yes** |
| Token | Token | `token` (sensitive), `provider`, `notes` | No |
| Note | Description | `content` | No |
| Document | AttachFile | `title`, `notes` | Yes |

Fields marked as sensitive are masked in the UI and require a deliberate reveal action.

#### Card fields in detail

| Field | Type | Required | Sensitive | Notes |
|-------|------|----------|-----------|-------|
| `card_network` | `select` | No | No | Options from `CARD_NETWORKS` (`apps/api/src/common/constants/card.constants.ts`): Visa, Mastercard, American Express, Discover, Diners Club, JCB, UnionPay, Maestro, RuPay, Elo, Hipercard, Other |
| `card_kind` | `select` | No | No | Options from `CARD_KINDS`: Credit, Debit, Prepaid, Other |
| `cardholder_name` | `string` | Yes | No | |
| `number` | `string` | Yes | Yes | Full PAN |
| `exp_month` | `string` | Yes | No | |
| `exp_year` | `string` | Yes | No | |
| `cvv` | `string` | Yes | Yes | CVV/CVC. Never sent to, or returned by, the AI extraction endpoint (see [Security Considerations](#security-considerations)) |
| `security_code_2` | `string` | No | Yes | Secondary security code (CID / control number, e.g. the 4-digit code on an Amex front) — a different value from the CVV |
| `issuing_bank` | `string` | No | No | |
| `notes` | `string` | No | No | |

`card_network` and `card_kind` are `required: false` even though they are always shown in the UI. This is deliberate and permanent: `validateDataAgainstType` rejects unknown keys, and a secret type's fields are append-only, so a `required: true` field added after cards already exist would make every pre-existing card permanently unsaveable on its next edit (there is no way to back-fill a value into an already-encrypted, per-version blob). Do not "fix" this by making them required.

### Custom Types

Users with the `secret_types:write` permission can create custom types. A custom type definition includes:

| Property | Constraints |
|----------|-------------|
| `name` | 1-100 characters, required |
| `description` | Optional, max 500 characters |
| `icon` | Optional, max 50 characters (Material UI icon name) |
| `fields` | Array of at least one `FieldDefinition` |
| `allowAttachments` | Boolean, default `false` |

Each `FieldDefinition` has:

| Property | Constraints |
|----------|-------------|
| `name` | Snake_case identifier matching `^[a-z][a-z0-9_]*$`, 1-50 characters |
| `label` | Display label, 1-100 characters |
| `type` | `string` \| `number` \| `date` \| `select` |
| `required` | Boolean |
| `sensitive` | Boolean, default `false` |
| `options` | `string[]`, 1-50 entries, each 1-100 characters, no duplicates. **Required when `type` is `select`, and rejected for every other type.** |

A `select` field without `options` fails DTO validation (`options is required for select fields`); a non-`select` field that supplies `options` also fails validation (`options is only allowed for select fields`). This is enforced at the DTO layer (`apps/api/src/secret-types/dto/create-secret-type.dto.ts`) for every type created or updated through the API. It is not enforced at the database level: a `select` field written directly to the database (or seeded before this constraint existed) with no `options` does not brick existing secrets — `validateDataAgainstType` treats an empty/missing `options` list on a `select` field as "anything goes" rather than rejecting every value.

A custom type cannot be deleted if any secret currently references it. The API returns `409 Conflict` in that case.

---

## Versioning

Every change to a secret's field data creates a new `SecretVersion` record with an incremented version number. Metadata-only changes (name, description) do not create new versions.

Version records store:

| Field | Description |
|-------|-------------|
| `encryptedData` | Base64-encoded ciphertext |
| `iv` | Base64-encoded 12-byte IV |
| `authTag` | Base64-encoded 16-byte GCM auth tag |
| `version` | Monotonically increasing integer |
| `createdById` | ID of the user who created this version |
| `createdAt` | Timestamp |
| `isCurrent` | Boolean; exactly one version per secret is current |

The combination of `[secretId, version]` is unique. Only one version per secret has `isCurrent = true` at any time.

**Attachments carry forward automatically.** Every new version — from a data edit (`PUT`), a rollback, or a renewal (`POST /:id/renew`) — copies every attachment row from its source version onto the new version (same `storageObjectId`; the row is a pointer, so the underlying file is shared, not duplicated). A version's attachment set is therefore never empty just because the secret was edited without touching files. This is implemented in one place, `SecretsService.createNewVersion()` / `carryForwardAttachments()`, so update, rollback, and renew cannot drift from each other.

---

## Rollback

Rolling back to a previous version creates a new version with that version's data rather than mutating history. The process:

1. Decrypt the target version's `encryptedData` using its stored `iv` and `authTag`.
2. Re-encrypt the plaintext with a fresh randomly generated IV.
3. Insert a new version record (next version number in the sequence) with the re-encrypted data.
4. Carry forward the **target** version's attachment set (not the current version's) — see below.
5. Mark the new version as current; mark all other versions as not current.
6. Log an audit event with the source `fromVersion` and the number of attachments carried forward.

**Example:** A secret has versions v1, v2, v3 (current). Rolling back to v1 produces v4 containing v1's data. v4 becomes current. v1, v2, and v3 remain in history unchanged.

The re-encryption step ensures IV uniqueness even when the same plaintext is stored multiple times.

**Rollback restores the target version's attachments, not the current version's.** If v1 had `card_front`/`card_back` images and v3 (current) has different ones, rolling back to v1 makes v4 carry v1's images — not v3's. Carrying the current version's files forward instead would show the restored card's old field values next to the wrong card's photos.

---

## Attachments

A secret type may set `allowAttachments: true` to permit file attachments. Attachments are stored via the Storage Objects API and linked to a secret through the `SecretAttachment` join table. As of migration `20260727120000_version_scoped_attachments`, attachments are scoped to a **specific `SecretVersion`**, not just to the secret.

### Version scoping

Every `SecretAttachment` row carries a `secretVersionId` (not-null, `onDelete: Cascade` from `SecretVersion`) in addition to `secretId`. This is what makes it possible for a historical version to keep showing its own files even after the secret has moved on to a new version with different (or additional) attachments — see [Versioning](#versioning) and [Rollback](#rollback) for how the carry-forward keeps a version's attachment set populated across edits.

Two unique constraints replace the old single-secret constraint:

| Constraint | Purpose |
|------------|---------|
| `[secretVersionId, storageObjectId]` | The same file cannot be linked twice to the same version. |
| `[secretVersionId, role]` | At most one attachment per **role** per version (see below). Postgres treats `NULL` as distinct from any other `NULL`, so this does *not* limit how many role-less (generic) attachments a version can have — only how many attachments of the *same named role* it can have. |

A conflict on either constraint returns `409 Conflict` with a message naming which side was duplicated (e.g. "This card already has a front image for the current version"), not a raw database error.

### Roles (card_front and card_back)

An attachment may optionally carry a `role`, one of `card_front` or `card_back` (`apps/api/src/secrets/dto/link-attachment.dto.ts`). These identify the two card-face images the Card import flow captures and are the only roles the API currently defines. An attachment with no role (`role: null`) is a generic file — e.g. a Document's supporting attachments — and a version may have any number of them.

**Card image constraints** apply only to `card_front` / `card_back` attachments (checked by `SecretsService.enforceCardImageConstraints()`, in both `linkAttachment` and `renew`):

- **Allowed MIME types:** `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif` (HEIC/HEIF included because iOS cameras produce them by default). The comparison strips parameters (e.g. `; charset=binary`) and lower-cases before matching.
- **Size limit:** 5 MB by default, overridable via the `CARD_IMAGE_MAX_BYTES` environment variable. An invalid override (non-numeric or ≤ 0) is ignored and logged, falling back to the 5 MB default rather than silently disabling the check.
- **Size is measured, not trusted, when the recorded size is 0.** The simple (`multipart/form-data`) upload path — the one the card capture UI uses — always records `size: BigInt(0)` at upload time and relies on a post-processor that does not exist to fill it in later. So for every real card image, `enforceCardImageConstraints` falls back to reading the object back from storage and counting bytes, stopping one byte past the limit. An object that cannot be read from storage is rejected (fails closed) rather than allowed through.
- **The MIME type itself is taken from the client's declared `Content-Type` for that multipart part (Fastify's `file.mimetype`) — it is not sniffed from the file's actual bytes.** A client that lies about the Content-Type of a non-image file with an accepted extension/type string is not currently caught by content inspection.

Generic (role-less) attachments have no MIME type or size constraint beyond whatever the Storage Objects API itself enforces.

### Deleting an attachment: refcounted, not automatic

**Deleting an attachment no longer unconditionally deletes the underlying storage object.** Because the same `storageObjectId` can now be referenced by multiple `SecretAttachment` rows — one per version it was carried forward onto, and potentially by another secret entirely — `unlinkAttachment()` only deletes the `StorageObject` row (and, best-effort, its blob) when **no other `SecretAttachment` row references it** after the unlink:

1. Lock the `storage_objects` row (`SELECT ... FOR UPDATE`).
2. Delete the `SecretAttachment` row.
3. Count remaining `SecretAttachment` rows referencing the same `storageObjectId`.
4. If zero, delete the `StorageObject` row; otherwise leave it (and the blob) in place.
5. Commit.
6. Only after commit, best-effort delete the blob from the storage provider. A blob-delete failure is logged, not thrown — the DB is already consistent, and the caller's unlink genuinely succeeded even if a byte is orphaned in storage.

The `FOR UPDATE` lock is what makes step 3 correct under concurrency: without it, two simultaneous unlinks of the last two references could each observe "1 remaining" and neither would delete, leaking the object and its blob forever.

### General

- Files are uploaded first via the Storage Objects API, then linked to a secret's current version using the returned storage object ID (`POST /secrets/:id/attachments`), or supplied as part of a renewal (`POST /secrets/:id/renew`).
- Each attachment record has an optional `label`.
- `GET /secrets/:id/attachments` defaults to the current version's attachments; pass `versionId` to read a historical version's set, and/or `role` to filter to one card face.
- The attachments tab in the UI is only shown when the secret's type has `allowAttachments: true`.

---

## API Reference

All endpoints require a valid JWT Bearer token. Ownership checks are enforced at the service layer: non-admin users can only access their own secrets. Admins with `*_any` permissions can access all secrets.

### Secrets — `/api/secrets`

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `POST` | `/secrets` | `secrets:write` | Create a secret with its initial version |
| `GET` | `/secrets` | `secrets:read` | List secrets (paginated) |
| `GET` | `/secrets/:id` | `secrets:read` | Get a secret with the decrypted current version |
| `PUT` | `/secrets/:id` | `secrets:write` | Update a secret; creates a new version if data changed |
| `DELETE` | `/secrets/:id` | `secrets:delete` | Delete a secret and all its versions |

**List query parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `page` | `1` | Page number |
| `pageSize` | `20` | Results per page (max 100) |
| `typeId` | — | Filter by secret type UUID |
| `search` | — | Case-insensitive name search |
| `sortBy` | `updatedAt` | `createdAt` \| `name` \| `updatedAt` |
| `sortOrder` | `desc` | `asc` \| `desc` |

### Versions — `/api/secrets/:id/versions`

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/secrets/:id/versions` | `secrets:read` | List version history (metadata only, no decrypted data) |
| `GET` | `/secrets/:id/versions/:versionId` | `secrets:read` | Get a specific version with decrypted data and that version's own attachments |
| `POST` | `/secrets/:id/versions/:versionId/rollback` | `secrets:write` | Rollback to this version (restores this version's attachment set) |

### Renewal (POST /secrets/:id/renew)

Requires `secrets:write`. Mints the next version from a **new** set of field values (a replacement, not a merge — a reissued card has a new number and often a new expiry and name) while swapping only the attachment roles present in the request; every other attachment is carried forward unchanged. Intended for a card that has been reissued, expired, or replaced after fraud, but works for any type that allows attachments.

Request body:

```json
{
  "data": { "cardholder_name": "...", "number": "...", "exp_month": "...", "exp_year": "...", "cvv": "..." },
  "attachments": [
    { "storageObjectId": "uuid", "role": "card_front" },
    { "storageObjectId": "uuid", "role": "card_back" }
  ],
  "aiAssisted": true
}
```

- `attachments` is optional and capped at 20 entries. Each entry with a `role` **replaces** the existing attachment for that role on the new version; entries with no `role` are additions. An entry that repeats a `role`, or repeats a `storageObjectId`, is rejected with `400` before any storage lookup happens.
- `aiAssisted` is a pure audit-trail flag (`extractionMethod: 'ai_assisted' | 'manual'` on the `secret.renew` audit event). It has no effect on validation or on what is stored.
- The previous (superseded) version is untouched: its own attachment rows still point at the old files, so the old card's number, expiry, name, **and photos** are all still readable together from the version history after a renewal.
- Version bump, selective carry-forward, and the replacement insert all happen in a single transaction; a failure anywhere in it leaves the previous version current and creates no partial version.
- Returns `409 Conflict` if a concurrent renewal collided on an attachment role.

### Attachments — `/api/secrets/:id/attachments`

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `POST` | `/secrets/:id/attachments` | `secrets:write` | Link a storage object to the secret's **current** version |
| `GET` | `/secrets/:id/attachments` | `secrets:read` | List attachments. Query: `versionId` (optional UUID, defaults to current version), `role` (optional, `card_front` \| `card_back`) |
| `DELETE` | `/secrets/:id/attachments/:attachmentId` | `secrets:write` | Remove the attachment; the underlying storage object is deleted only if no other attachment row (any version, any secret) still references it |

### Secret Types — `/api/secret-types`

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `POST` | `/secret-types` | `secret_types:write` | Create a custom type |
| `GET` | `/secret-types` | `secret_types:read` | List all types |
| `GET` | `/secret-types/:id` | `secret_types:read` | Get a type by ID |
| `PUT` | `/secret-types/:id` | `secret_types:write` | Update a custom type |
| `DELETE` | `/secret-types/:id` | `secret_types:delete` | Delete a custom type |

**Secret types list query parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `search` | — | Case-insensitive name search |
| `includeSystem` | `true` | Whether to include the six built-in system types |

---

## RBAC Permissions

| Permission | Admin | Contributor | Viewer |
|------------|-------|-------------|--------|
| `secrets:read` | Yes | Yes | Yes |
| `secrets:write` | Yes | Yes | No |
| `secrets:delete` | Yes | Yes | No |
| `secrets:read_any` | Yes | No | No |
| `secrets:write_any` | Yes | No | No |
| `secrets:delete_any` | Yes | No | No |
| `secret_types:read` | Yes | Yes | Yes |
| `secret_types:write` | Yes | Yes | No |
| `secret_types:delete` | Yes | Yes | No |

**Ownership model:** Users without `*_any` permissions can only read, update, or delete secrets they own. Ownership checks are enforced at the service layer in addition to the controller-level permission guards.

---

## Data Validation

When creating or updating a secret, the provided data object is validated against the secret type's field definitions before encryption. Validation rules:

- Required fields must be present and non-empty.
- Unknown fields (keys not defined in the type's field list) are rejected.
- Type coercion is not performed; types must match exactly:
  - `string` — any string value
  - `number` — numeric value; `NaN` is rejected
  - `date` — ISO 8601 date string
  - `select` — the value must appear in the field's `options` list (case-sensitive, exact match). If the field somehow has no `options` (e.g. a row written before this constraint existed), the check is skipped rather than rejecting every value — see [Custom Types](#custom-types) for why `options` is otherwise mandatory for `select` fields at the DTO layer.

Validation failures return `400 Bad Request` with a `details` array identifying each invalid field.

---

## Audit Trail

Every secret and secret type operation is written to the `audit_events` table. The following events are logged:

| Event | Metadata |
|-------|----------|
| `secret.create` | `{ name, typeId }` |
| `secret.update` | `{ name, dataChanged, carriedAttachments? }` |
| `secret.delete` | `{ name }` |
| `secret.rollback` | `{ fromVersion, carriedAttachments }` |
| `secret.renew` | `{ fromVersionId, version, carriedAttachments, replacedAttachments, replacedRoles, extractionMethod }` — `extractionMethod` is `'ai_assisted'` or `'manual'`, from the request's `aiAssisted` flag |
| `secret.attachment.unlink` | `{ attachmentId, storageObjectId, storageObjectDeleted }` |
| `secret_type.create` | `{ name }` |
| `secret_type.update` | `{ name }` |
| `secret_type.delete` | `{ name }` |
| `ai.card.extract` | `{ imageCount, model, durationMs, outcome, errorCode? }` — written by the AI extraction endpoint, not the secrets module; see [API.md](API.md#ai-card-extraction) |

**No audit event is written when an attachment is linked** (`POST /secrets/:id/attachments` / a renewal's replacements). Only the unlink path (`secret.attachment.unlink`) and the version-level events (`secret.create`, `secret.update`, `secret.renew`, `secret.rollback` — which record `carriedAttachments` counts) currently touch the audit log for attachments. If your operational or compliance requirements assume a link-time audit row, note that one does not exist yet.

The AI card-extraction audit row is deliberately minimal: it never records an image, a field value, or a confidence score — only counts, timing, the model name, and outcome. It is also the only record used to enforce the daily per-user extraction budget (`maxCallsPerUserPerDay`): the budget check counts `ai.card.extract` rows in the last 24 hours, and the row is written *before* the provider call so a crashed request still consumes budget rather than being free to retry indefinitely.

Audit records include the acting user's ID and a timestamp, providing a forensic trail for all sensitive operations.

---

## Frontend

### Pages

- `/secrets` — Paginated list view with search, type filter, and sort controls. Includes a create dialog for adding new secrets.
- `/secrets/:id` — Tabbed detail view with three tabs: Details (decrypted current version), Version History (timeline with rollback controls), and Attachments (only present when the type allows attachments).
- `/secret-types` — Management page for viewing system types (read-only) and creating, editing, or deleting custom types.

### Key Behaviors

- Sensitive fields are displayed as masked characters. Users must click a reveal control to view the plaintext.
- The version history tab presents a timeline. Each entry shows the version number, who created it, and when. Rollback buttons are available on non-current versions.
- The attachments tab is conditionally rendered based on the secret type's `allowAttachments` flag.
- System types are rendered as read-only; edit and delete controls are hidden.
- The create and edit forms are dynamically generated from the type's field definitions, including the correct input type and sensitive masking per field.

---

## CLI and Automation

Document-type secrets can be created and updated programmatically using the `vaultcli` CLI without any browser interaction. The `vaultcli secrets create` and `vaultcli secrets update` commands accept `--data` as a JSON object and work with any secret type, including Document.

The `vaultcli sync` command automates this for local `.env` files (or any UTF-8 text file): it registers files or directories locally and, on each `sync run`, compares local content to the Vault copy via client-side SHA-256 hashing, then pushes only changed files as new versions of their corresponding Document secrets. This makes it straightforward to keep server environment files backed up in Vault with full version history, safe to call from cron. See [ENV-SYNC.md](ENV-SYNC.md) for the full guide.

---

## Security Considerations

**Encryption key loss is permanent.** There is no recovery mechanism. If `VAULT_ENCRYPTION_KEY` is lost or corrupted, all encrypted secret data becomes unrecoverable. Store the key in a secure secrets manager (e.g., AWS Secrets Manager, HashiCorp Vault) and maintain an offline backup.

**No key rotation.** The current implementation uses a single static key for all encrypted data. Re-encrypting existing secrets with a new key is not yet supported. Treat the key as permanent for the lifetime of the installation.

**IV uniqueness.** Each encryption operation generates a fresh 12-byte IV via `crypto.randomBytes(12)`. This includes rollback operations, which re-encrypt the historical plaintext rather than copying the original ciphertext. This prevents IV reuse, which would be catastrophic for AES-GCM security.

**Authentication tag verification.** GCM mode produces a 16-byte authentication tag over both the ciphertext and any additional authenticated data. Any modification to the stored ciphertext, IV, or auth tag will cause decryption to fail with an explicit error rather than returning corrupted plaintext.

**Service-layer ownership enforcement.** Access control is not limited to HTTP guards and decorators. The service layer independently verifies that the requesting user owns the resource (or holds an `*_any` permission) before performing any read, write, or delete operation.

**Audit coverage.** All mutations and rollbacks are logged to `audit_events` with user ID and timestamp. This log should be treated as append-only and protected from modification. Note the gap above: attachment *linking* is not currently audited, only unlinking and the version-level events that record carry-forward counts.

**Card images are card data, not incidental files.** A `card_front` / `card_back` attachment is a photograph of a physical payment card — it can show the full PAN, expiry, cardholder name, and (depending on framing) the CVV printed on the back. It should be handled with the same sensitivity as the `number` field itself: access to it is gated by the same secret-level ownership/`*_any` permission check as the rest of the secret, and it is refcount-deleted like any other attachment (see [Attachments](#attachments)) — but nothing about the storage layer encrypts the image bytes at rest beyond whatever the S3-compatible provider does. Unlike `number` and `cvv`, the image is not passed through `CryptoService`.

**Clipboard exposure and auto-clear.** Copying a sensitive field value (e.g. the card number) uses the browser Clipboard API and shows a transient "copied" acknowledgement for 1.5 seconds (`COPIED_RESET_MS` in `apps/web/src/hooks/useCopyToClipboard.ts`). This resets the UI's own `copied`/`failed` indicator state — it does **not** clear the value from the OS clipboard itself. The copied plaintext therefore remains available to any other application on the user's device (or a malicious clipboard-reading page) until the user copies something else over it. There is no clipboard-clearing timer.

**AI card extraction sends the full, uncropped camera frame to a third party (OpenAI) in a single call — this is a privacy-relevant change from earlier behavior.** This is a new category of data egress for this application: previously, no secret data ever left the API process except in an HTTP response to the authenticated owner. `POST /api/secrets/cards/extract` sends the full front and, when provided, back photo — both as base64 data URLs, downscaled only past a 3072px long edge and otherwise uncropped and unrotated — to the OpenAI vision model configured in system settings in **one combined request, not one call per side**, so the model can cross-reference whichever side actually carries the printed number, expiry, and cardholder name; many modern and metal cards (e.g. a metal American Express Platinum) print these on the back rather than the front. **State this plainly: whatever background surrounds the card in frame — a desk, a hand, other nearby objects or documents — now leaves the device and reaches OpenAI along with the card itself.** This is a change from the previous crop-before-send behavior, where only the card rectangle was ever transmitted. It remains true that the full frame is never uploaded to this application's own storage: only the AI-cropped (or user-adjusted) card rectangle is ever saved as a `card_front`/`card_back` attachment — see the next paragraph. A provider failure now fails the whole extraction — there is no degraded front-only fallback. This happens only when:
- an administrator has explicitly set `ai.enabled: true` in system settings (default: `false`), **and**
- an administrator has stored a working OpenAI API key.

**The model locates the card for you; cropping now happens after the fact, from the model's answer.** The response carries `crops.front`/`crops.back` — a bounding box, in fractions of the image as sent, plus the clockwise quarter-turns needed to make the card read upright and a confidence score for the box itself (see [API.md](API.md#ai-card-extraction)). The web app (`apps/web/src/utils/cardImage.ts`, `apps/web/src/components/cards/CardCropReview.tsx`) renders the crop from the *raw* capture — not the possibly-downscaled photo that was sent to OpenAI — using that box with a small margin and a snap to the card's aspect ratio, and always shows a per-side "Adjust crop" control (`CardCropAdjuster.tsx`: zoom 1-4x, drag-to-pan, 90° rotation over a live preview) seeded from the AI box so the user can correct a bad guess before anything is saved. A malformed or absent box degrades to a centered auto-fit rectangle rather than failing the extraction. Only the resulting crop — never the full frame — is JPEG-encoded and stored: it is still larger than before the card epic, up to 2048px on its longest edge (previously 1400px), so faint laser-engraved text on metal cards survives the crop and downscale legibly; the JPEG quality ladder (`apps/web/src/utils/cardImage.ts`) still bounds the resulting upload size. That 2048px figure applies only to the stored attachment's encode step — it has no bearing on the (larger, uncropped) photo sent to OpenAI for extraction.

**The CVV is never part of this egress.** `EXTRACTED_FIELD_NAMES` (`apps/api/src/ai/providers/vision-provider.interface.ts`) deliberately excludes `cvv` from what the model is asked to extract, and the extraction response schema has no field for it — the review form always seeds `cvv` as an empty string, regardless of what the model returned for anything else. The same file adds `notes`: auxiliary, non-sensitive printed text (customer service numbers, a "Member Since" year, a website, a contactless indicator, usage instructions) that the other fields have no slot for. Both the prompt and the response schema explicitly ban the PAN and any security code — CVV or `security_code_2` — from `notes`; on the wire it is truncated at 1000 characters rather than the 200 applied to other string fields. On card renewal, extracted `notes` are appended under the secret's existing notes rather than overwriting them (`apps/web/src/hooks/useCardRenewal.ts`). See [API.md](API.md#ai-card-extraction) and [SECURITY-ARCHITECTURE.md](SECURITY-ARCHITECTURE.md) §8 (AI Features and Data Egress) for the full data-flow, key-storage, and mitigation details.

**`card_kind` may be classified instead of read, within limits.** When a card doesn't print "Credit", "Debit", or "Prepaid" (American Express never does), the model may infer `card_kind` from unambiguous product knowledge rather than returning `null`. It is the only field allowed to work that way: `number`, `exp_month`, `exp_year`, `cardholder_name`, and `security_code_2` must always be transcribed from the images, never guessed. The inference is fenced — a printed `card_kind` carries high confidence, while an inferred one carries moderate confidence (around `0.6`, not a hard cap) with a warning always attached — so the review screen presents an inferred `card_kind` as a suggestion, not a confirmed reading.

**No real OpenAI call has ever been exercised.** As of this writing, the OpenAI vision provider (`apps/api/src/ai/providers/openai/openai-vision.provider.ts`) is covered only by unit tests against a mocked HTTP layer (`openai-vision.provider.spec.ts`). There is no integration test, staging deployment, or manual QA pass on record that has sent a real request to OpenAI. Treat the provider's error-mapping and response-parsing logic as unverified against the real API's actual behavior until that changes.
