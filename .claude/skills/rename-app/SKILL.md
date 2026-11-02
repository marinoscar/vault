---
name: rename-app
description: Rebrand Vault or a fork of it - set the application name, repository slug, CLI name and brand colours through the identity codemod (packages/shared/identity.json and scripts/rename.mjs, created in E1) and finish the steps it cannot do. Applies once E1 (toolchain) has landed. Use when the user asks to rename the app, change the product name or theme colour.
---

# Rebranding

> **Applies from E1.** Today Vault has no `packages/shared/identity.json` and no `scripts/rename.mjs`; identity strings (`Vault`, `vault`, `vaultcli`, `VAULT_*`) are scattered. E1 introduces the manifest and the codemod copied from EAB. Until then a rename is a manual, high-risk edit: do not start one without an issue and the user's explicit go-ahead. The brand that ships with E10 is deep teal and amber on the existing `media/` logo ([ux-refresh](../../../docs/specs/ux-refresh.md)); changing the colours later is a `--theme` run, not a hand edit.

The human guide is EAB `docs/RENAMING.md`; this is the procedure.

## Step 0 - preconditions

A tracking issue (a rebrand is a feature: `feature_request.yml`) and a worktree (or the designated branch in a cloud session). Read `docs/platform-adoption/local-exceptions.md` first.

## Step 1 - gather values, never guess them

Product display name (`--name`), repository slug (`--repo`, published in the OpenAPI document), brand primary colour (`--theme`, 6-digit hex), splash colour (`--background`), tagline. **Ask separately whether the CLI binary is renamed** (default no; Vault's binary is `vault` after E11, `vaultcli` before).

## Step 2 - dry run, confirm, run

```bash
node scripts/rename.mjs --name "<name>" --repo <owner/name> --theme '#rrggbb' --dry-run
```

Show the plan, then run for real (needs a clean tree, so `git checkout .` is a full undo). If an anchor does not match, stop and fix the anchor in the script; never loosen it. Read the residual scan.

## Step 3 - never rename these (permanent data)

- **`VAULT_ENCRYPTION_KEY`** and anything feeding `CryptoService`: renaming the variable or changing the key makes every secret version, the stored AI key and the scheduled-backup password unreadable. A repo-wide case-insensitive find-and-replace is the realistic way this happens. Do not run one.
- Persisted identifiers: audit action names (`secrets.export`, `backups.export`, `ai.card.extract`), job type strings (`vault.backup.run`, once they exist), permission strings, role names, storage key prefixes (`user-backups/<userId>/`, `database-backups/`), installed migration directory names, the `refresh_token` cookie name.
- The state/sentinel literals the platform fixes (`.appctl-deploy.json`, `# Managed by appctl deploy`) once E11 lands.

## Step 4 - verify and commit

```bash
npm install
cd apps/api && npm run typecheck && npm test
cd ../web && npm run typecheck && npm run test:run && npm run build
```

One commit: `feat(core): rebrand to <name>`, `Relates to #<n>`. Then tell the user what nothing in the repo can do: rename the GitHub repository and update `origin`, update the Google OAuth redirect URIs to match `APP_URL`, and (if the binary was renamed) migrate machines that already run the CLI.
