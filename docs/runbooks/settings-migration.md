# Runbook: move stored settings onto the platform layout (E4.1)

Issue #79. Command: `npm run vault:migrate-settings` (from `apps/api`; `-- --apply` writes). Code: `apps/api/src/settings/settings-migration.ts`.

## What changes

- `system_settings` (`global`): **nothing moves.** `ui`, `features` and `ai` keep their keys and shapes; `vaultCards`, `vaultBackups` and `maintenance` read as their defaults until an admin saves them. The command only reports whether a pre-E4.2 `ai.apiKey` ciphertext block is still in the row.
- `user_settings`: `profile.useProviderImage` becomes `profile.imageSource` (`false` is `none`, anything else `provider`), `imageObjectId` is set to `null`, a non-empty `profile.customImageUrl` is kept, a null or empty one is dropped. `theme` and every other key are untouched. The version of each rewritten row is incremented.

The API reads an unmigrated row correctly (the platform normalises `useProviderImage` on read), so the command is a tidy-up, not a prerequisite for deploying.

## Order

1. Back up the database.
2. `npm run vault:migrate-ai-key -- --apply` first if the dry run of that command still finds a legacy key (the platform carries the old block forward, but the key should move into the credential store: [ai-key-migration](ai-key-migration.md)).
3. `npm run vault:migrate-settings` (dry run). It prints counts only, never a value.
4. `npm run vault:migrate-settings -- --apply`.

## Properties

- Dry run by default; idempotent (a rerun reports zero changes and writes no audit row).
- Each row is written with an optimistic `version` check; a row changed meanwhile is skipped and counted (`changed meanwhile`), rerun to pick it up.
- One `audit_events` row (`settings.migrated`, counts only) per applied run.

## Rollback

Restore the backup, or leave the rows as they are: a pre-E4.1 build would read `imageSource` rows with `useProviderImage` missing and treat it as unset (the toggle defaults on), so rolling back the API without restoring loses only the "do not use the provider picture" choice.
