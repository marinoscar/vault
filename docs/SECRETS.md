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
```

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

Six system types are created during database seeding. They cannot be modified or deleted.

| Type | Icon | Fields |
|------|------|--------|
| Credential | Key | `username`, `password` (sensitive), `url`, `notes` |
| API Key | VpnKey | `key` (sensitive), `provider`, `notes` |
| Card | CreditCard | `cardholder_name`, `number` (sensitive), `exp_month`, `exp_year`, `cvv` (sensitive), `notes` |
| Token | Token | `token` (sensitive), `provider`, `notes` |
| Note | Description | `content` |
| Document | AttachFile | `title`, `notes`. Attachments allowed. |

Fields marked as sensitive are masked in the UI and require a deliberate reveal action.

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
| `type` | `string` \| `number` \| `date` |
| `required` | Boolean |
| `sensitive` | Boolean, default `false` |

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

---

## Rollback

Rolling back to a previous version creates a new version with that version's data rather than mutating history. The process:

1. Decrypt the target version's `encryptedData` using its stored `iv` and `authTag`.
2. Re-encrypt the plaintext with a fresh randomly generated IV.
3. Insert a new version record (next version number in the sequence) with the re-encrypted data.
4. Mark the new version as current; mark all other versions as not current.
5. Log an audit event with the source `fromVersion`.

**Example:** A secret has versions v1, v2, v3 (current). Rolling back to v1 produces v4 containing v1's data. v4 becomes current. v1, v2, and v3 remain in history unchanged.

The re-encryption step ensures IV uniqueness even when the same plaintext is stored multiple times.

---

## Attachments

A secret type may set `allowAttachments: true` to permit file attachments. Attachments are stored via the Storage Objects API and linked to a secret through the `SecretAttachment` join table.

Key behaviors:

- Files are uploaded first via the Storage Objects API, then linked to a secret using the returned storage object ID.
- Each attachment record has an optional `label`.
- The constraint `[secretId, storageObjectId]` prevents duplicate links.
- Deleting an attachment also deletes the underlying storage object. This is a hard delete of the file, not just the link.
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
| `GET` | `/secrets/:id/versions/:versionId` | `secrets:read` | Get a specific version with decrypted data |
| `POST` | `/secrets/:id/versions/:versionId/rollback` | `secrets:write` | Rollback to this version |

### Attachments — `/api/secrets/:id/attachments`

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `POST` | `/secrets/:id/attachments` | `secrets:write` | Link a storage object to this secret |
| `GET` | `/secrets/:id/attachments` | `secrets:read` | List attachments |
| `DELETE` | `/secrets/:id/attachments/:attachmentId` | `secrets:write` | Remove the attachment and delete the storage object |

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

Validation failures return `400 Bad Request` with a `details` array identifying each invalid field.

---

## Audit Trail

Every secret and secret type operation is written to the `audit_events` table. The following events are logged:

| Event | Metadata |
|-------|----------|
| `secret.create` | `{ name, typeId }` |
| `secret.update` | `{ name, dataChanged }` |
| `secret.delete` | `{ name }` |
| `secret.rollback` | `{ fromVersion }` |
| `secret.attachment.unlink` | `{ attachmentId, storageObjectId }` |
| `secret_type.create` | `{ name }` |
| `secret_type.update` | `{ name }` |
| `secret_type.delete` | `{ name }` |

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

## Security Considerations

**Encryption key loss is permanent.** There is no recovery mechanism. If `VAULT_ENCRYPTION_KEY` is lost or corrupted, all encrypted secret data becomes unrecoverable. Store the key in a secure secrets manager (e.g., AWS Secrets Manager, HashiCorp Vault) and maintain an offline backup.

**No key rotation.** The current implementation uses a single static key for all encrypted data. Re-encrypting existing secrets with a new key is not yet supported. Treat the key as permanent for the lifetime of the installation.

**IV uniqueness.** Each encryption operation generates a fresh 12-byte IV via `crypto.randomBytes(12)`. This includes rollback operations, which re-encrypt the historical plaintext rather than copying the original ciphertext. This prevents IV reuse, which would be catastrophic for AES-GCM security.

**Authentication tag verification.** GCM mode produces a 16-byte authentication tag over both the ciphertext and any additional authenticated data. Any modification to the stored ciphertext, IV, or auth tag will cause decryption to fail with an explicit error rather than returning corrupted plaintext.

**Service-layer ownership enforcement.** Access control is not limited to HTTP guards and decorators. The service layer independently verifies that the requesting user owns the resource (or holds an `*_any` permission) before performing any read, write, or delete operation.

**Audit coverage.** All mutations and rollbacks are logged to `audit_events` with user ID and timestamp. This log should be treated as append-only and protected from modification.
