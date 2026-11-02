# Platform adoption

Vault is migrating from the very old copy of EnterpriseAppBase (EAB) it forked from onto the published `@marinoscar/platform-*` packages (pinned `0.1.0-next.21`), the same way `kvox` was. The program is epic [#54](https://github.com/marinoscar/vault/issues/54); this documentation epic is E0 ([#55](https://github.com/marinoscar/vault/issues/55)). As of E2.1 and E2.2 Vault consumes `@marinoscar/platform-db` (composed Prisma schema, the platform migration history, `platform.lock`); the other slices were adopted by E3 onwards.

## Program status

**E0 to E12 are done** (E11.3, [#101](https://github.com/marinoscar/vault/issues/101), is the close-out: the final drift report, the full conformance run and this documentation). What is left is the [open follow-ups](local-exceptions.md#status-at-close-out-e113-101) (five temporary items) and the [permanent divergences](local-exceptions.md#permanent-divergences). Final drift: [drift-final.md](drift-final.md) (models 15 of 46 to 46 of 46, migrations 2 to 40 of 40 shared, `infra` 3% to 84% identical).

| File | What it is |
|---|---|
| [module-classification.md](module-classification.md) | Hand-written. Every API module, web area, CLI, Prisma model, migration and infra file classified as noise, backport, domain or vault-divergence, with the target slice and the epic that deals with it |
| [local-exceptions.md](local-exceptions.md) | Every place Vault deviates from the platform on purpose, and the epic that removes it (or why it is permanent). An exception without a row is a bug |
| [schema-delta.md](schema-delta.md) | What platform migrations 0003 to 0040 add to the Vault database (E2.1 and E2.2) |
| [../runbooks/database-baseline.md](../runbooks/database-baseline.md) | The one-time baseline of a live database onto the platform history: rehearsal, production window, rollback |
| [drift-baseline.md](drift-baseline.md) | The raw generated drift report at the start of the program. Frozen; never edited |
| [drift-final.md](drift-final.md) | The drift report re-run at close-out (E11.3), with baseline-versus-final numbers and every remaining difference classified. Frozen |

## Baseline

| Field | Value |
|---|---|
| EAB commit | `59e377cbebb60e711fe4d7b0d818715f23af8a59` |
| Vault commit | `1b2074d` (`1b2074ddce5215ad15a05ffc7ac5071505ea7dfc`) |
| Date | 2026-11-02 |
| Platform packages | `0.1.0-next.21` |

## Regenerating the drift report

Run EAB's script from an EAB checkout, never from inside either repository's tree being compared, and write to a scratch directory:

```bash
cd <EAB>   # at the baseline commit for a like-for-like comparison
node scripts/platform-drift.mjs --app ../vault \
  --app-product-name Vault --app-repo-slug marinoscar/vault --app-cli-name vault \
  --format md --out <dir>   # --app-repo-slug must be owner/name
```

The report is generated data. A later run goes to a new file (`drift-final.md` is the E11.3 one), never over an existing report. Replace local absolute paths with `EnterpriseAppBase` and `vault` if you commit one. Note the apps view compares file by file: once both sides hold only bindings, "modified" measures Vault's own options, not owned code. For API modules read the classification table, which names the packaged slice.

## Categories

- **noise**: differs only in comments, whitespace, identity or is covered by a package with no behaviour loss. The package replaces it; delete on adoption.
- **backport**: Vault changed a base module in a way the platform lacks. Re-express it as a workaround on top of the package (side table, registry entry, override) and, where it is a real gap, file a seam request on EAB.
- **domain**: Vault product code (secrets, secret types, versions, attachments, card extraction, media, backups content). Stays in `apps/` and is packaged as `@marinoscar/vault-*` in E12.
- **vault-divergence**: Vault solves the same problem differently and keeps its design. The row says whether it converges and when, or that it is permanent.

## Epic order (program #54)

Epics run in this order; each builds on the previous.

| Epic | Status | Scope |
|---|---|---|
| E0 | Done (#55, #106) | Docs and AI-assistant foundation (this folder, `AGENTS.md`, agents, skills, templates, `docs/specs/ux-refresh.md`) |
| E1 | Done (#107 to #112) | Toolchain: Node 24, Prisma 7, React 19 + MUI 9, zod, `packages/shared/identity.json`, rename codemod |
| E2 | Done (#111, #113) | Database baseline: fragments, `platform db baseline` on live data (rehearsed on a restored copy), app DB role `NOSUPERUSER NOBYPASSRLS`, `platform.lock` |
| E3 | Done (#114, #121, #127) | Host and identity slices (auth, users, allowlist, PAT, device auth, health, request ids) |
| E4 | Done (#116, #124) | Settings and credentials slices (system/user settings registries, encrypted credential store for runtime keys) |
| E5 | Done (#126, #129) | Jobs and nodes: backups become job types `vault.backup.run` and `vault.user_backup.run` |
| E6 | Done (#133, #141) | Storage slice (providers, objects API, post-upload processors) |
| E7 | Done (#128, #131, #134) | Email and notifications |
| E8 | Done (#136) | AI: card extraction via `AiService.forUser` feature `card-extract` |
| E9 | Done (#138, #139, #142) | db-backup, telemetry (Uptrace to GreptimeDB), exports, user-data, onboarding |
| E10 | Done (#115 to #143) | UI/UX refresh: platform shell, destinations Home/Secrets/Cards/Media + pinned Settings/Console, settings hub, datatable secrets list, home dashboard ([spec](../specs/ux-refresh.md)) |
| E11 | Done (#122, #123; close-out #101) | CLI on `createCli` (`vault` binary), `platform:infra:sync`, conformance suites |
| E12 | Done (#147 to #150) | `@marinoscar/vault-*` domain packages (packages first) |

Decisions (all held): production data is migrated **in place**; `VAULT_ENCRYPTION_KEY` stays an app-owned key for secret ciphertext; domain code stays in `apps/` until E12; the brand keeps the `media/` logo with new deep-teal/slate and amber tokens.

## Working rules during the migration

- A platform gap is a seam request on marinoscar/EnterpriseAppBase (`seam_request.yml`), not a local copy. Record any stop-gap in [local-exceptions.md](local-exceptions.md); the PR that removes it deletes the row.
- A shim in code carries the comment `// PLATFORM-ADOPTION-SHIM(<epic or issue>)`.
- Each epic's PR updates [module-classification.md](module-classification.md) status notes, `docs/ARCHITECTURE.md`, and the assistant files it makes stale.
