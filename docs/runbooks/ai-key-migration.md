# Runbook: move the OpenAI key to the credential store (E4.2)

Issue [#80](https://github.com/marinoscar/vault/issues/80), epic #54. Applies once, to every database that configured an AI key before E4.2.

## What changes

| | Before | After |
|---|---|---|
| Where | `system_settings.value -> ai -> apiKey` (JSON: ciphertext, iv, authTag, last4, updatedAt) | `credentials` row, purpose `ai`, name `openai` |
| Key | `VAULT_ENCRYPTION_KEY` (hex, `CryptoService`) | `SECRETS_ENCRYPTION_KEY` (base64, platform cipher, HKDF sub-key `ai`) |
| Read by | `SystemSettingsService.getOpenAiApiKeyPlaintext()` | `AiConfigService` via `CredentialsService.getSecret('ai', 'openai')` |

`(ai, openai)` is the address the platform AI slice reads, so E8 does not move the key a second time. The rest of `system_settings.ai` (`enabled`, `model`, `maxCallsPerUserPerDay`) stays where it is until E8. **Secret values, backups and the scheduled-backup password are not touched**: they stay under `VAULT_ENCRYPTION_KEY`.

There is deliberately **no fallback read** of the old field. After you deploy the new build and before you run the command, AI card scanning reports "not configured" (`503 AI_NOT_CONFIGURED`, `GET /api/ai/status` says disabled). Run the command in the same maintenance window as the deploy.

## 0. Prerequisites

1. Both keys are set in the API's environment: `VAULT_ENCRYPTION_KEY` (the existing one, unchanged) and the new `SECRETS_ENCRYPTION_KEY`.

   ```bash
   openssl rand -base64 32     # generate SECRETS_ENCRYPTION_KEY once; store it with VAULT_ENCRYPTION_KEY
   ```

   Never reuse one value for the other. Back up both with the database: losing `SECRETS_ENCRYPTION_KEY` makes the stored credential unreadable (an administrator re-enters the key); losing `VAULT_ENCRYPTION_KEY` loses every secret value.
2. The build with E4.2 is deployed and the database is migrated (`credentials` exists since platform migration 0003).
3. Doctor (`/admin/settings` Doctor, or `GET /api/admin/doctor`) shows `secrets.encryption-key` as **pass**.

## 1. Back up

Take a database backup first (the admin backup, or `pg_dump`). The command changes one `system_settings` row and writes one `credentials` row; for a belt-and-braces copy of the row only:

```bash
psql "$DATABASE_URL" -c "COPY (SELECT * FROM system_settings WHERE key = 'global') TO STDOUT" > settings-global.backup   # contains ciphertext; store like a secret
```

## 2. Dry run

From the repo root (or `apps/api`; in Docker, `exec api`):

```bash
npm run vault:migrate-ai-key
# docker compose ... exec api npm run vault:migrate-ai-key
```

The default mode changes nothing. Expected output (counts and booleans only, never the key):

```
mode: dry run (pass --apply to change anything)
legacy key in system_settings.ai: present
legacy key decrypts with VAULT_ENCRYPTION_KEY: yes
legacy key mask: ••••abcd
credential ai/openai: absent
outcome: would-migrate
```

| Outcome | Meaning | Action |
|---|---|---|
| `would-migrate` | Key found and readable; nothing stored yet | Go to step 3 |
| `would-blank-only` | The credential already holds this very key (an earlier run stopped before blanking) | Go to step 3 |
| `nothing-to-migrate` | No legacy key (never configured, or already migrated) | Done; verify in step 4 |
| `conflict` (exit code 2) | A **different** credential is already stored | Nothing was changed. The credential is newer than the old field. In the admin AI settings re-enter or clear the key (either blanks the old field), or decide which key is right and delete the other |
| error `decrypt-legacy` (exit 1) | The old block does not decrypt with the current `VAULT_ENCRYPTION_KEY` (rotated or wrong) | Restore the key it was written with, or skip the command and re-enter the key in the admin AI settings |

## 3. Apply

```bash
npm run vault:migrate-ai-key -- --apply
```

Order of operations: decrypt with `VAULT_ENCRYPTION_KEY`, store the credential under `SECRETS_ENCRYPTION_KEY`, **read it back and compare**, and only then blank `ai.apiKey` (a guarded update on the row version it read, so a concurrent admin save is detected instead of overwritten). A failure at any step leaves the key readable from one place or the other; rerun to finish. An `audit_events` row `ai.key.migrated` records the move (no key, no mask). The command is idempotent: a rerun reports `nothing-to-migrate`.

## 4. Verify

1. `GET /api/system-settings` (admin): `ai.apiKeyConfigured` is `true`, `apiKeyLast4` matches the mask printed in the dry run, and the body has no key material.
2. In the admin AI settings use **Verify connection** (`POST /api/system-settings/ai/verify`). It resolves the key from the credential store and makes a minimal call; success proves the whole path.
3. `GET /api/ai/status` reports `enabled: true` (when the feature flag is on). Optionally scan one card.
4. In the database: `SELECT purpose, name, hint FROM credentials WHERE purpose = 'ai';` shows one row, and `SELECT value->'ai'->'apiKey' FROM system_settings WHERE key = 'global';` is `null`.
5. Re-run the dry run: `outcome: nothing-to-migrate`, `credential ai/openai: present`.

## 5. Rollback

The old field is blanked, so rollback means putting the row back:

1. Restore the `system_settings` row (`global`) from the backup of step 1 (or the full database backup). This restores `ai.apiKey` under `VAULT_ENCRYPTION_KEY`.
2. Deploy the pre-E4.2 build, which reads the old field.
3. The `credentials` row is harmless; delete it with the admin AI settings ("clear key") on the E4.2 build, or `DELETE FROM credentials WHERE purpose = 'ai' AND name = 'openai';`.

If you cannot roll back the row but have the key itself, the simplest repair is to re-enter it in the admin AI settings; that writes the credential directly.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `SECRETS_ENCRYPTION_KEY is missing or malformed` | Variable absent, or not base64 for exactly 32 bytes | `openssl rand -base64 32`, set it, restart |
| `AI_KEY_UNREADABLE` (503) after a deploy | `SECRETS_ENCRYPTION_KEY` was changed after the key was stored | Restore the original key, or re-enter the OpenAI key |
| `AI_NOT_CONFIGURED` (503) right after deploy | The command has not run yet (no fallback read) | Run steps 2 and 3 |
| API refuses to boot, naming `SECRETS_ENCRYPTION_KEY` | Malformed value, or unset while `credentials` has rows | Set the original value |
| `concurrent-write` | An admin saved settings during the run | Rerun; the credential is already stored |
