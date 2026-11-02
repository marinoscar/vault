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
| [platform-adoption/drift-baseline.md](platform-adoption/drift-baseline.md) | Frozen generated drift report | |
| [specs/ux-refresh.md](specs/ux-refresh.md) | UX spec for E10: destinations, shell, brand, settings hub, datatable, Home | |
| [specs/README.md](specs/README.md) | Historical implementation specs 01 to 24 | |
| [System_Specification_Document.md](System_Specification_Document.md) | Original system specification | |
| [../infra/deploy/DEPLOY.md](../infra/deploy/DEPLOY.md) | Production VPS deployment runbook | |
| [../tools/vaultcli/README.md](../tools/vaultcli/README.md) | `vaultcli` usage, install, backup and sync | |
| [../tools/app/README.md](../tools/app/README.md) | Generic template CLI (replaced in E11) | |

## Doc map by task

| I want to... | Read |
|---|---|
| Understand the system | ARCHITECTURE.md sections 1 to 3, then the component you touch |
| Add or change an endpoint | `apps/api/AGENTS.md`, API.md (the area's `###`), DOMAIN-REFERENCE.md; permissions: SECURITY-ARCHITECTURE.md RBAC section |
| Work on secrets, versions or attachments | SECRETS.md (Versioning, Attachments), root invariants in AGENTS.md |
| Work on backups or export | SECRETS.md "Backup and export", API.md backups sections; `backup-runner.service.ts` is an E5 exception ([local-exceptions](platform-adoption/local-exceptions.md)) |
| Work on card scanning | SECRETS.md (Card fields), `apps/api/src/ai/card-extract.*`; AI rules in AGENTS.md |
| Change the database | DEVELOPMENT.md, `.claude/skills/platform-migration/SKILL.md`; installed migrations are immutable |
| Add a settings screen | `.claude/skills/add-settings-page/SKILL.md`, specs/ux-refresh.md |
| Change navigation, theme or the UI shell | specs/ux-refresh.md, `apps/web/AGENTS.md` |
| Add a background job | `.claude/skills/add-job-type/SKILL.md` (from E5) |
| Add a notification or email | `.claude/skills/add-notification/SKILL.md` (from E7) |
| Add a CLI command | `tools/AGENTS.md`, tools/vaultcli/README.md |
| Run tests | TESTING.md, `apps/api/AGENTS.md`, `apps/web/AGENTS.md` |
| Deploy | infra/deploy/DEPLOY.md, DEV-VPS-SETUP.md |
| Understand the platform migration | platform-adoption/README.md, then module-classification.md |
| Know why code deviates from the platform | platform-adoption/local-exceptions.md |
| Rebrand | `.claude/skills/rename-app/SKILL.md` (from E1) |
| Set up an AI assistant session | AI-ASSISTANTS.md |

## Conventions

- New docs are linked here. Mark target-state content "TARGET, created in E<n>" and do not link files that do not exist yet.
- Specs `01` to `24` in `specs/` are historical; current behaviour lives in ARCHITECTURE.md, API.md and SECRETS.md.
- Never put real secrets, keys, card numbers or user material in a doc; use placeholders.
