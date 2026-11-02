# Vault documentation

Index of every document in `docs/`, plus the "Doc map by task". Rules for assistants and contributors: [../AGENTS.md](../AGENTS.md). Read large docs by section (`grep -n '^#' <file>`, then offsets); never whole.

## Index

| Doc | What it covers | Size |
|---|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System overview, principles, stack, components, storage subsystem, data architecture, security architecture | large |
| [DOMAIN-REFERENCE.md](DOMAIN-REFERENCE.md) | Compact endpoint groups, RBAC, tables, allowlist and environment variables (moved from the old `CLAUDE.md`) | small |
| [API.md](API.md) | Endpoint reference per area; live OpenAPI at `/api/docs` | 90 KB |
| [SECRETS.md](SECRETS.md) | Secrets feature: encryption, types, versions, rollback, attachments, card scanning, backup and export | 60 KB |
| [SECURITY-ARCHITECTURE.md](SECURITY-ARCHITECTURE.md) | Auth, tokens, RBAC layers, allowlist, hardening | large |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Dev loop, environment variables, debugging, database changes | |
| [TESTING.md](TESTING.md) | Test tiers, helpers, fixtures | |
| [DEVICE-AUTH.md](DEVICE-AUTH.md), [personal-access-tokens.md](personal-access-tokens.md) | Device authorization (RFC 8628) and PATs | |
| [ENV-SYNC.md](ENV-SYNC.md), [DEV-VPS-SETUP.md](DEV-VPS-SETUP.md) | Environment sync; dev VPS setup | |
| [AI-ASSISTANTS.md](AI-ASSISTANTS.md) | How `AGENTS.md`, `CLAUDE.md`, agents and skills fit together; the no-real-material rule | |
| [platform-adoption/README.md](platform-adoption/README.md) | Platform migration (program #54): baseline, epic order | |
| [platform-adoption/module-classification.md](platform-adoption/module-classification.md) | Every module classified, with target slice and epic | |
| [platform-adoption/local-exceptions.md](platform-adoption/local-exceptions.md) | Deliberate deviations and what removes them | |
| [platform-adoption/schema-delta.md](platform-adoption/schema-delta.md) | What platform migrations 0003 to 0040 add to the database | |
| [runbooks/production-cutover.md](runbooks/production-cutover.md) | **Upgrade production to the platform (start here)**: the ordered checklist for a live pre-platform deployment (rehearsal, window, rollback, after) | |
| [runbooks/database-baseline.md](runbooks/database-baseline.md) | One-time baseline of a live database onto the platform history (rehearse, window, rollback) | |
| [runbooks/settings-migration.md](runbooks/settings-migration.md) | Move pre-E4.1 user profiles onto the platform settings layout (`vault:migrate-settings`) | |
| [runbooks/database-restore.md](runbooks/database-restore.md) | Whole-database backup and restore (`db-backup` slice): keys that must match, pre-flight, manual and automated restore, rollback, rehearsal | |
| [runbooks/factory-reset.md](runbooks/factory-reset.md) | Delete a user's data and factory reset a deployment (back up first, verify, recover) | |
| [runbooks/storage-config-migration.md](runbooks/storage-config-migration.md) | Move the S3 environment variables onto the runtime storage settings (`vault:migrate-storage-config`, boot-time import, cut-over, rollback) | |
| [decisions/README.md](decisions/README.md), [decisions/0001-packages-first.md](decisions/0001-packages-first.md) | Architecture decision records; ADR-0001: domain code lives once in `@marinoscar/vault-*` | |
| [PACKAGES.md](PACKAGES.md) | The `vault-contract` and `vault-db` packages: layout, build, tests, `vault.lock`, versioning plan | |
| [runbooks/release-vault-packages.md](runbooks/release-vault-packages.md) | Release the `@marinoscar/vault-*` packages: changesets, the `next` dist-tag, OIDC trusted publishing, owner setup, dry run, rollback | |
| [runbooks/vault-domain-migration.md](runbooks/vault-domain-migration.md) | Author a domain migration (`vault-db promote`), install the domain into a new host, fix a failing `vault-db check` | |
| [platform-adoption/drift-baseline.md](platform-adoption/drift-baseline.md) | Frozen generated drift report (start of the program) | |
| [platform-adoption/drift-final.md](platform-adoption/drift-final.md) | Frozen drift report at close-out (E11.3) with remaining drift classified | |
| [specs/ux-refresh.md](specs/ux-refresh.md) | UX spec for E10: destinations, shell, brand, settings hub, datatable, Home | |
| [specs/README.md](specs/README.md) | Historical implementation specs 01 to 24 | |
| [System_Specification_Document.md](System_Specification_Document.md) | Original system specification | |
| [../infra/deploy/DEPLOY.md](../infra/deploy/DEPLOY.md) | Production VPS deployment runbook | |
| [../apps/cli/README.md](../apps/cli/README.md) | `vault` CLI usage, install, backup and sync; migrating from `vaultcli` | |

## Doc map by task

| I want to... | Read |
|---|---|
| Understand the system | ARCHITECTURE.md sections 1 to 3, then the component you touch |
| Add or change an endpoint | `apps/api/AGENTS.md`, API.md (the area's `###`), DOMAIN-REFERENCE.md; permissions: SECURITY-ARCHITECTURE.md RBAC section |
| Work on secrets, versions or attachments | SECRETS.md (Versioning, Attachments), root invariants in AGENTS.md |
| Work on backups or export | SECRETS.md "Backup and export" (and "Whole-database backup versus encrypted secret backups"), API.md backups sections, runbooks/database-restore.md for the whole-database slice; backups are queue jobs since E5.2 ([local-exceptions](platform-adoption/local-exceptions.md#e52-backups-as-queue-jobs-done)) |
| Work on card scanning | SECRETS.md (Card fields), `apps/api/src/ai/card-extract.*`; AI rules in AGENTS.md |
| Change the database | DEVELOPMENT.md, `.claude/skills/platform-migration/SKILL.md`; installed migrations are immutable |
| Add a settings screen | `.claude/skills/add-settings-page/SKILL.md`, specs/ux-refresh.md |
| Change navigation, theme or the UI shell | specs/ux-refresh.md, `apps/web/AGENTS.md` |
| Add a background job | `.claude/skills/add-job-type/SKILL.md` (from E5) |
| Add a notification or email | `.claude/skills/add-notification/SKILL.md` (from E7) |
| Add a CLI command | `apps/cli/AGENTS.md`, apps/cli/README.md |
| Run tests | TESTING.md, `apps/api/AGENTS.md`, `apps/web/AGENTS.md` |
| Deploy | infra/deploy/DEPLOY.md, DEV-VPS-SETUP.md |
| Change a domain table, add a wire schema or error code | PACKAGES.md, runbooks/vault-domain-migration.md, decisions/0001-packages-first.md |
| Understand the platform migration | platform-adoption/README.md, then module-classification.md |
| Know why code deviates from the platform | platform-adoption/local-exceptions.md |
| Rebrand | `.claude/skills/rename-app/SKILL.md` (from E1) |
| Set up an AI assistant session | AI-ASSISTANTS.md |

## Conventions

- New docs are linked here. Mark target-state content "TARGET, created in E<n>" and do not link files that do not exist yet.
- Specs `01` to `24` in `specs/` are historical; current behaviour lives in ARCHITECTURE.md, API.md and SECRETS.md.
- Never put real secrets, keys, card numbers or user material in a doc; use placeholders.
