# Runbook: Move Object Storage Configuration from Environment Variables to Runtime Settings

Applies to the deploy of E6.1 ([#84](https://github.com/marinoscar/vault/issues/84), epic [#61](https://github.com/marinoscar/vault/issues/61)), which replaces Vault's own `storage/` module with the platform storage slice.

Object storage holds secret attachments, card faces, media files and the logical backups (system and "My backups"). Until E6.1 the bucket was configured by environment variables. Since E6.1 it is **runtime configuration** and the variables are not read:

| Was an environment variable | Is now |
|---|---|
| `STORAGE_PROVIDER` (`s3`) | `provider` of the `storage` system setting: `s3`, `r2` or `s3compatible` |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT` | `bucket`, `region`, `endpoint` of the active driver's settings |
| `AWS_ACCESS_KEY_ID` | `accessKeyId` of the active driver's settings (not secret) |
| `AWS_SECRET_ACCESS_KEY` | the credential `storage` / `default`, encrypted with `SECRETS_ENCRYPTION_KEY` (never `VAULT_ENCRYPTION_KEY`) |

Still environment variables, because they bound a deployment and name no account: `MAX_FILE_SIZE`, `ALLOWED_MIME_TYPES`, `SIGNED_URL_EXPIRY`, `STORAGE_PART_SIZE`.

Source of truth: `apps/api/src/platform/storage/` (`storage.config.ts`, `storage-key-prefix.manifest.ts`, `storage-env-import*.ts`), `apps/api/scripts/migrate-storage-config.ts`, `apps/api/src/doctor/checks/vault-storage-env.doctor-check.ts`. The platform's own description of the admin page and the drivers is in the `@marinoscar/platform-api/storage` README.

---

## 1. What happens on deploy, with no action from you

The API runs the import **once at boot**, only while all of these hold:

1. `S3_BUCKET` names a real bucket (empty and the `.env.example` placeholder `your-bucket-name` do not count).
2. `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are both set.
3. The runtime configuration does not already hold a **different** bucket or a **different** stored secret. Runtime configuration wins; it is never overwritten.

It stores the secret first (and reads it back), then writes the `storage` settings with an optimistic version check, then records an `audit_events` row `storage.config.imported` (driver and bucket, never the key). A second boot reports `already-configured` and writes nothing. It never fails the boot: an error is logged with its stage name only.

Mapping: `S3_ENDPOINT` set becomes the **`s3compatible`** driver (MinIO, LocalStack, an R2 endpoint ...; path-style addressing, as the old provider always forced when an endpoint was set); otherwise the **`s3`** driver. The region defaults to `us-east-1`, the old default.

So **a deployment that keeps its variables through the upgrade keeps working** without a gap: the first boot copies them. The variables are not a fallback: nothing reads them after the import, and the Doctor warns while they remain (section 5).

## 2. When the import does not apply, and the manual path

| Situation | What to do |
|---|---|
| The deployment authenticates with an IAM role / instance profile (no `AWS_*` keys). The old provider used the default AWS credential chain; **the platform driver requires a static key pair** | Create an access key (policy in section 6), then enter the configuration at `/admin/settings/storage`. The boot log says `lack AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY`. This is a behaviour change to plan for |
| `SECRETS_ENCRYPTION_KEY` is missing or malformed | The credential store refuses the key and the import logs `store-credential`. Set it (`openssl rand -base64 32`; it must not change afterwards) and restart, or run the command |
| The variables are already gone from `.env` (rebuilt environment) | Nothing to import. Enter the configuration at `/admin/settings/storage` using the values you recorded |
| You want to look before anything is written | Run the command in dry-run mode (section 3) **before** deploying, against a restored copy |

## 3. The command

```bash
# From a shell that has the legacy variables (or infra/compose/.env) and POSTGRES_*,
# SECRETS_ENCRYPTION_KEY:
npm run vault:migrate-storage-config                # dry run (default): changes nothing
npm run vault:migrate-storage-config -- --apply     # store the credential, write the settings
```

In the API container: `docker compose exec api npm run vault:migrate-storage-config -- --apply`.

Output is booleans, names and the (non-secret) bucket, never the key:

```
mode: dry run (pass --apply to change anything)
legacy variables set: STORAGE_PROVIDER, S3_BUCKET, S3_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
legacy bucket: <bucket> (driver s3)
runtime storage settings name a bucket: no
credential storage/default: absent
outcome: would-import
```

| Outcome | Exit | Meaning |
|---|---|---|
| `nothing-to-import` | 0 | The environment names no bucket |
| `would-import` | 0 | Dry run: an apply would store the key and write the settings |
| `imported` | 0 | Done (also finishes a half-done earlier run) |
| `already-configured` | 0 | Runtime configuration already holds this bucket and secret |
| `conflict` | 2 | Runtime configuration holds a different bucket or secret. Nothing changed. Remove the variables, or fix the page |
| `incomplete` | 3 | One of the two access keys is missing. Nothing changed. Use the admin page |
| (stage error) | 1 | `store-credential`, `verify-credential`, `settings-row-missing` (run `prisma:seed` first), `write-settings`, `concurrent-write` (an admin saved at the same moment; rerun) |

It is idempotent. Rerun it freely.

## 4. Production cut-over

Do this once. A maintenance window is optional: while storage is unconfigured uploads and downloads answer 503, and boot normally imports the configuration within seconds.

1. **Record** the current values from the running `.env` (bucket, region, endpoint, access key id; keep the secret in a password manager) and confirm `SECRETS_ENCRYPTION_KEY` is set. Take a database backup.
2. **Rehearse** on a restored copy: `npm run vault:migrate-storage-config` (dry run) must say `would-import`.
3. **Deploy.** Leave the variables in `.env` for this deploy. Boot imports them (section 1). Look for `Imported the storage configuration from the environment` in the API log.
4. **Verify** (section 5).
5. **Clean up**: remove `STORAGE_PROVIDER`, `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from `.env` and recreate the containers. (`AWS_*` may still be read by the email slice's SES fallback; if you send through SES and set the SES region and keys at the email settings page, they are not needed.) The Doctor warning clears.

## 5. Verify

- `/admin/settings/storage` (once the web card ships; until then `GET /api/admin/storage-config` as an administrator) shows the bucket and `hasValue` for the secret, and **Test** passes all checks.
- `GET /api/storage/status` reports storage as configured.
- Download an **existing** attachment, card face and media file: they are served from their stored `storage_key` (`uploads/<timestamp>/...`), so they open without any key change. Download a system backup and a "My backups" archive from the Backups pages.
- Upload a new attachment: its key is `uploads/<orgId>/<timestamp>/<uuid><ext>`.
- The Doctor page (or `GET /api/admin/doctor`): `vault.storage_env` is **pass** after step 5 of the cut-over (**warn** while the variables remain).

## 6. What the access key needs

For an S3 bucket, a policy on the bucket and its objects: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:AbortMultipartUpload`, `s3:ListMultipartUploadParts`, `s3:ListBucket`. The **Create bucket** button also needs `s3:CreateBucket`, `s3:PutBucketPublicAccessBlock`, `s3:PutEncryptionConfiguration`, `s3:PutBucketCORS`. CORS and the Content Security Policy for the browser's direct uploads are unchanged by E6.1.

## 7. Existing objects and the purge

Every object Vault wrote stays where it is under its current key. The platform reads and deletes by the row's stored `storage_key`, never a rebuilt one. Vault registers every prefix it writes so `npm run storage:purge` and an organization offboarding reach it:

| Prefix | Written by | Scope |
|---|---|---|
| `uploads/` | Secret attachments, card faces and media files (all `storage_objects` rows). Old keys `uploads/<timestamp>/<uuid>`, new keys `uploads/<orgId>/<timestamp>/<uuid>` | org (platform) |
| `system-backups/` | The admin's logical system backups (`backup_runs.storage_key`, no `storage_objects` row) | deployment |
| `user-backups/` | "My backups" (`user-backups/<userId>/...`) | user |
| `avatars/`, `node-outputs/`, `storage-config-test/` | The platform (avatars are not used by Vault) | user / deployment |

`test/storage/` and the `storage` conformance suite fail if a registered prefix is malformed or overlaps another, or if `system-backups` or `user-backups` is unregistered.

## 8. Rollback

The previous image does not read the runtime configuration, so rolling the **image** back needs the variables back in `.env`. Keep them (step 5 of the cut-over is last for this reason) until you are sure. The import never deletes the variables, never touches objects, and the credential and settings it wrote are harmless to the old image. To undo the import itself: clear the settings at `/admin/settings/storage`, or `DELETE` the credential `storage/default` through the page, and remove the `storage` key from `system_settings.global`.

## 9. Risks to know

- **No static key, no storage.** IAM-role deployments must create an access key (section 2).
- **Multi-instance**: the `storageConfigured` flags on the Backups pages read a per-process snapshot of the bucket, refreshed by every storage call and at startup. After an admin saves the page on one instance, an idle second instance may report "not configured" until its next storage operation (Vault runs one API instance).
- **The simple upload is capped at the smaller of `MAX_FILE_SIZE` and 10 GiB**, as before (`VAULT_MAX_SIMPLE_UPLOAD_BYTES` in `storage.config.ts`); the platform default of 100 MiB would have broken large media files.
- **Download Content-Type for backups** comes from the object (uploaded as `application/zip`); the platform's signed-URL options have no response-content-type override.
