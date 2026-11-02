# Runbook: move card scanning onto the platform AI slice (E8)

Issues [#87](https://github.com/marinoscar/vault/issues/87) (E8.1, the code) and [#88](https://github.com/marinoscar/vault/issues/88) (E8.2, the stored configuration), epic [#63](https://github.com/marinoscar/vault/issues/63). Applies **once per deployment** that had AI card scanning configured before E8.1. Modelled on KVox's `ai-platform-migration` runbook.

## What changes

| | Before (E4.2 build) | After (E8.1 build) |
|---|---|---|
| Provider call | Vault's own `OpenAiVisionProvider` (fetch to the chat completions API) | The platform AI slice (`AiService.forUser`, the OpenAI adapter of `@marinoscar/platform-ai-providers`) |
| Deployment key | credential `('ai', 'openai')` | **the same row** - no key move, no re-entry |
| Policy | Vault's `ai` block: `enabled`, `provider`, `model`, `maxCallsPerUserPerDay` | the platform `ai` namespace: `enabled`, `keyPolicy`, `providers.openai.enabled`, `limits`, plus Vault's `cardExtractModel` |
| Model | `ai.model` (any string) | `ai.cardExtractModel`, **and** an enabled row in `ai_models` (a gate) |
| Daily budget | `maxCallsPerUserPerDay`, rolling 24 h, counted from `audit_events` `ai.card.extract` | `ai.limits.perUser.requestsPerDay`, UTC calendar day, counted from `ai_usage_events` (all AI calls of the user) |
| Burst limit | in-memory 10 per 5 min per process | **dropped**; set `ai.limits.perUser.requestsPerMinute` if you want one |
| Verify | `POST /api/system-settings/ai/verify` | the slice's provider test on the admin AI page |
| Permissions | `secrets:write` | `secrets:write` **and** `ai:use` (Contributors and org admins hold it; Viewers do not) |
| CVV | extracted | **never requested, never returned** (E8.1 behaviour change) |
| Admin UI | System settings, AI card (PATCH `ai.apiKey`) | the platform admin AI routes (`/api/admin/ai/*`); the web pages follow in the frontend PR |

The migration touches **only** the `ai` key of `system_settings.global` and adds one `ai_models` row. It never reads, moves or prints the key, never touches secrets, backups or any other namespace, and never re-enables a model an administrator disabled.

## 0. Prerequisites

1. The build with E8.1 is deployed, the database is migrated (`npm run prisma:migrate`; E8.1 adds **no migration**: the platform AI tables came with the baseline) and the seed has run (`npm run prisma:seed`): the seed registers the new permissions `ai:use`, `ai_config:read/write`, `org_ai_config:read/write` and grants them (`ai:use` to `contributor` and `org_admin`).
2. Pre-E4.2 databases: `npm run vault:migrate-ai-key -- --apply` first ([ai-key-migration.md](ai-key-migration.md)). The command below refuses (`PROBLEM:`) while an `ai.apiKey` ciphertext block remains.
3. `SECRETS_ENCRYPTION_KEY` is set (the command only *describes* the key).
4. Between deploying the build and running the command, card scanning answers `503 AI_NOT_CONFIGURED` and `GET /api/ai/config` says disabled (the platform reads the old block as "no provider on"); nothing errors. Run the command in the same window as the deploy.

## 1. Back up

Take an admin backup or a `pg_dump` (the rollback of last resort), and keep the snapshot path of step 3 on a volume that survives the container.

## 2. Dry run (the default)

```bash
cd infra/compose
docker compose -f base.compose.yml -f prod.compose.yml exec api npm run vault:migrate-ai-platform
```

Reads, writes nothing (no row, no file). Example report:

```
mode: dry run (pass --apply to change anything)
outcome: would-migrate
legacy ai block: present (will be rewritten)
settings: enabled=true cardExtractModel=gpt-4o-mini perUserRequestsPerDay=50
model: gpt-4o-mini -> would-create
deployment key ai/openai: present
```

Read it:

- `perUserRequestsPerDay` is the old `maxCallsPerUserPerDay`. A value of `0` (scanning blocked) becomes `ai.enabled = false` (the cap schema takes positive numbers only); the report says so.
- `model: ... -> exists (enabled=false)` means an administrator disabled that model in the catalogue; the command leaves it that way. Enable it on the admin AI page or card scanning answers `503 AI_NOT_CONFIGURED`.
- `PROBLEM:` lines make the exit code `1` and an apply refuses: a pre-E4.2 key block waiting, or AI enabled with no deployment key stored.

## 3. Apply

```bash
docker compose -f base.compose.yml -f prod.compose.yml exec api \
  npm run vault:migrate-ai-platform -- --apply --snapshot /var/backups/ai-platform-legacy.json
```

In this order: the snapshot of the old `ai` block (no key material; the command refuses to overwrite an existing snapshot), the `ai_models` row (`provider openai`, `modelId = ai.model`, capabilities from the platform's OpenAI classifier, source `admin_override`, **enabled**), then the `ai` block (guarded on the row version, so a concurrent admin save is detected, not overwritten) and one `audit_events` row `system_settings:ai-platform-migrate` (names and counts only). It also sets `ai.keyPolicy = byok_with_org_fallback`: Vault users hold no key of their own, so the deployment key must serve every caller.

Idempotent: a rerun reports `already-migrated`, leaves the row version and the catalogue alone and writes no snapshot or audit row.

## 4. Verify

1. `GET /api/ai/config` as any user: `{ "data": { "enabled": true, ... } }` with the `openai` provider `enabled` and `hasOrgKey` true.
2. As a Contributor, scan a card (front and back). The result has no `cvv` (the form asks the user to type it). On `/admin/settings/ai` (or `GET /api/admin/ai/usage`) one usage row appears under feature `card_extract`.
3. As a Viewer, the scan route answers `403` (no `secrets:write`, no `ai:use`).
4. Optional: set `ai.limits.perUser.requestsPerMinute` for a short burst limit.

## 5. Rollback

The old build reads the old block, so rolling back is: redeploy the previous image, then put the snapshot back (this restores the settings; the extra `ai_models` row is harmless):

```bash
psql "$DATABASE_URL" <<'SQL'
-- <snapshot> is the "ai" object of /var/backups/ai-platform-legacy.json
UPDATE system_settings
   SET value = jsonb_set(value, '{ai}', '<snapshot>'::jsonb), version = version + 1
 WHERE key = 'global';
SQL
```

The old build needs `ai.provider/model/maxCallsPerUserPerDay`, all in the snapshot. If the snapshot is lost, restore the backup of step 1 ([database-restore](../specs/README.md)); or re-enter the three values on the previous build's AI settings card. The deployment key never moved, so the old build finds it where it left it.

## What is not migrated

- **The burst limiter** (in-memory counters, nothing persistent).
- **Usage history**: the old budget counted `audit_events` rows `ai.card.extract`; they stay in place (a purge may remove them) and are no longer read.
- **The CVV**: extraction no longer returns one. Existing saved cards keep their stored `cvv` field.
