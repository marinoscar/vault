# CLAUDE.md

@AGENTS.md

Claude Code loads the shared rules above (project overview, structure, every MANDATORY section, key commands) from [AGENTS.md](AGENTS.md). Area rules load from the nested `AGENTS.md` of the folder you work in (`apps/api`, `apps/web`, `tools`). This file adds only what is specific to Claude Code: the documentation table, the subagent delegation rules and the cloud-session exception. How Claude Code and OpenCode share these files: [docs/AI-ASSISTANTS.md](docs/AI-ASSISTANTS.md).

## MANDATORY: No real people, companies or user material

Never use real people, companies or material a user shares as examples, fixtures or test data; use invented placeholders. Rule and exemptions: [AGENTS.md](AGENTS.md#mandatory-no-real-people-companies-or-user-material).

## Cloud sessions

The worktree rule in AGENTS.md has an exception: in a cloud session, or whenever the environment has already put you on a designated branch, work on the branch the session designates instead of creating a worktree. The PR rules still apply: commit in slices, push that branch, open the PR against `main`.

## Where things are documented

Full index with a "Doc map by task": [docs/README.md](docs/README.md). Read docs by section (`grep -n '^#'`, then offsets); `docs/API.md` is 90 KB.

| Topic | Read |
|---|---|
| Architecture, repository layout, data model | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Endpoint, RBAC, table and env-var quick map (moved from the former CLAUDE.md) | [docs/DOMAIN-REFERENCE.md](docs/DOMAIN-REFERENCE.md) |
| Secrets, versions, attachments, card types, backup and export | [docs/SECRETS.md](docs/SECRETS.md) |
| Security design, allowlist, sessions | [docs/SECURITY-ARCHITECTURE.md](docs/SECURITY-ARCHITECTURE.md) |
| Endpoint reference (per area); live OpenAPI at `/api/docs` | [docs/API.md](docs/API.md) |
| Dev loop, environment variables, debugging; env sync | [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md), [docs/ENV-SYNC.md](docs/ENV-SYNC.md) |
| Testing tiers, helpers, fixtures | [docs/TESTING.md](docs/TESTING.md) |
| Device authorization and personal access tokens | [docs/DEVICE-AUTH.md](docs/DEVICE-AUTH.md), [docs/personal-access-tokens.md](docs/personal-access-tokens.md) |
| Platform migration (program epic #54): plan, module classification, local exceptions, drift baseline | [docs/platform-adoption/README.md](docs/platform-adoption/README.md), [module-classification](docs/platform-adoption/module-classification.md), [local-exceptions](docs/platform-adoption/local-exceptions.md), [drift-baseline](docs/platform-adoption/drift-baseline.md) |
| Spec: UX refresh (destinations, shell, brand, settings hub, datatable; E10) | [docs/specs/ux-refresh.md](docs/specs/ux-refresh.md) |
| Original implementation specs 01 to 24 (historical) | [docs/specs/README.md](docs/specs/README.md), [docs/System_Specification_Document.md](docs/System_Specification_Document.md) |
| Deployment (VPS) and dev VPS setup | [infra/deploy/DEPLOY.md](infra/deploy/DEPLOY.md), [docs/DEV-VPS-SETUP.md](docs/DEV-VPS-SETUP.md) |
| CLIs: `vaultcli` (domain), `tools/app` (template) | [tools/vaultcli/README.md](tools/vaultcli/README.md), [tools/app/README.md](tools/app/README.md), [tools/AGENTS.md](tools/AGENTS.md) |
| Area rules (API, web, tools) | [apps/api/AGENTS.md](apps/api/AGENTS.md), [apps/web/AGENTS.md](apps/web/AGENTS.md), [tools/AGENTS.md](tools/AGENTS.md) |
| Recipe: add a job type (applies from E5) | [.claude/skills/add-job-type/SKILL.md](.claude/skills/add-job-type/SKILL.md) |
| Recipe: add a settings page (applies from E10; rule now) | [.claude/skills/add-settings-page/SKILL.md](.claude/skills/add-settings-page/SKILL.md) |
| Recipe: change the schema / platform migration (applies from E2) | [.claude/skills/platform-migration/SKILL.md](.claude/skills/platform-migration/SKILL.md) |
| Recipe: add a notification (applies from E7) | [.claude/skills/add-notification/SKILL.md](.claude/skills/add-notification/SKILL.md) |
| Recipe: rename or rebrand (applies from E1) | [.claude/skills/rename-app/SKILL.md](.claude/skills/rename-app/SKILL.md) |
| How Claude Code and OpenCode share these files | [docs/AI-ASSISTANTS.md](docs/AI-ASSISTANTS.md) |

## Specialized Subagents (MANDATORY)

Delegate development work to the matching subagent in `.claude/agents/`. Each agent carries its domain's rules and points to the docs that own the details, so delegation keeps patterns consistent.

| Agent | Domain | MUST use for |
|---|---|---|
| `backend-dev` | NestJS API, Fastify, auth, RBAC | **Any** backend code: endpoints, services, guards, middleware, JWT, OAuth, backups, job handlers |
| `frontend-dev` | React, MUI, TypeScript | **Any** frontend code: components, pages, hooks, theming, responsive design |
| `database-dev` | PostgreSQL, Prisma | **Any** database work: schema, migrations, seeds, queries |
| `testing-dev` | Jest/Supertest (API), Vitest/RTL (web), node:test (vaultcli) | **Any** testing: unit, integration, typecheck, fixtures |
| `docs-dev` | Technical documentation | **Any** documentation: ARCHITECTURE.md, SECURITY-ARCHITECTURE.md, API.md, README, specs, runbooks |
| `ops-dev` | Routine operations (Haiku) | Rebuilding/restarting containers, running Prisma migrations, running typecheck |

Delegation rules:

1. Backend code changes → `backend-dev`.
2. Frontend code changes → `frontend-dev`.
3. Database/Prisma changes → `database-dev`.
4. Writing or updating tests → `testing-dev`.
5. Documentation updates → `docs-dev`.
6. Routine ops (container rebuilds, migrations, typecheck) → `ops-dev`. `ops-dev` must **never** perform state-changing git operations (pull, merge, push, commit, worktree or branch management); the main agent does those, and `ops-dev` refuses them.

Multi-domain tasks invoke several agents in sequence, for example a new user preference setting: `database-dev` (migration) → `backend-dev` (endpoint) → `frontend-dev` (UI) → `testing-dev` (tests) → `docs-dev` (docs).

```
"Use backend-dev to implement the user settings endpoint"
"Use testing-dev to write integration tests for auth"
"Use ops-dev to rebuild the api container and run migrations"
```

Do not write controllers, services, guards, components, Prisma schema, migrations, tests or documentation directly. The only exceptions:

- Reading files to understand context.
- Answering questions about the codebase.
- Planning and coordinating between agents.
- Running simple commands (`git status`, `npm install`, etc.).
