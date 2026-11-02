# Working with AI assistants

> **Audience:** engineers using AI assistants on this repository · **Rules:** [AGENTS.md](../AGENTS.md)

Claude Code (Anthropic models) is the assistant configured here. The rule set is written tool-neutrally in `AGENTS.md` so OpenCode (a local open-weight model on llama.cpp, as used in the sibling repositories) can read the same files if it is added later. This page says where each file lives, how to keep them in step and carries the full text of the no-real-material rule.

Rule: **`AGENTS.md` is the single shared rule set.** Edit rules there. Never copy a rule into `CLAUDE.md` or an agent file.

## File map

| File | Read by | Purpose | Size budget |
|---|---|---|---|
| `AGENTS.md` | Claude Code (via `CLAUDE.md`), OpenCode | Shared rules: overview, structure, every MANDATORY section, commands | 24 KB |
| `CLAUDE.md` | Claude Code | Starts with `@AGENTS.md` (an import), then Claude-only content: the docs table, delegation rules, cloud-session exception | none |
| `apps/api/AGENTS.md`, `apps/web/AGENTS.md`, `apps/cli/AGENTS.md` | the assistant working in that folder | Area rules | 6 KB each |
| `.claude/agents/*.md` | Claude Code | Subagents `backend-dev`, `frontend-dev`, `database-dev`, `testing-dev`, `docs-dev`, `ops-dev`; frontmatter `name`, `description`, optional `model` | none |
| `.claude/skills/<name>/SKILL.md` | Claude Code | On-demand recipes: `add-job-type`, `add-settings-page`, `platform-migration`, `add-notification`, `rename-app`. Several describe the platform slice they belong to and apply once that epic lands (see each file's first lines) | 10 KB each |
| `.claude/settings.local.json` | Claude Code (local) | Personal permission allow-list; not shared | none |
| `.opencode/agents/`, `opencode.json` | OpenCode | Not present. Add them only with a parity check (every `.claude/agents` file has a twin) | 6 KB each |

Load order: `CLAUDE.md` loads, `@AGENTS.md` inlines the shared rules, nested `AGENTS.md` files are read when you work in their folder, agents and skills load on demand.

## Choosing how to work

| Task | Approach |
|---|---|
| Large or cross-cutting change (API + web + database) | Main agent plans, delegates to subagents in sequence |
| Schema migrations, encryption or auth changes | Main agent plus `database-dev` / `backend-dev`; rehearse on a restored copy |
| Reading large docs, architecture questions | Read by section (`grep -n '^#'`, then offsets) |
| Mechanical work (typecheck, rebuilds) | `ops-dev` (never git) |

## Working with a small context window

| Practice | How |
|---|---|
| One agent at a time by default | The main agent plans; one subagent works |
| One worktree per agent | `git worktree add worktrees/<short-name> -b <type>/<short-name>`; never two agents in one tree |
| Read docs by section | `grep -n '^#' docs/<file>.md`, then Read with `offset` and `limit` |
| Never read whole | `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/SECRETS.md`, `docs/SECURITY-ARCHITECTURE.md`, a spec |
| Hand over a pointer | Give the subagent the doc path and section, not the text |
| Area rules | Nested `AGENTS.md` files hold area rules, so root `AGENTS.md` stays small |

## No real people, companies or user material

The root `AGENTS.md` carries the short rule; this is the full text.

- **Material a user shares is never reused.** Never use the content of documents, notes, screenshots, card photos, exported backups or any other material the user shares with an assistant, or anything derived from it (names, numbers, quotes, structure that identifies it), in code, tests, fixtures, evaluation sets, prompts, documentation, examples, issues, pull requests or commit messages. Shared material is used only to diagnose the problem in the conversation.
- **No real names as examples.** Never use the name of a real person, or a real company, organization, product or brand, as an example anywhere in the repository: code comments, test data, fixtures, docs, issue and PR text. Use clearly invented placeholders: `Person A`, `Avery Example`, `Org Alpha`, `Org Beta`, `Product X`, `Project P1`, and `@example.test` email addresses. Do not borrow well-known fictional brands either (Contoso, Acme, Northwind, Initech).
- **Secrets in fixtures are fake.** Passwords, API keys and tokens in tests are obviously synthetic (`example-password-1`), and card fixtures use published test numbers, never a real card.
- **Exempt, and only these:** a real vendor or service a feature integrates by name (for example the OpenAI provider adapter, Google OAuth, S3, their SDK package names and documented endpoints), and legal or authorship metadata (package `author`, copyright lines).
- **Fix what you find.** When you find a real name used as an example, replace it with a placeholder in the same change, or open a follow-up if it changes recorded snapshots.

## Maintenance

| Change | Do this |
|---|---|
| Change a rule | Edit `AGENTS.md` (or the nested one for an area). Keep `AGENTS.md` at 24 KB or less and nested files at 6 KB or less |
| Claude-only content | Edit `CLAUDE.md` below the `@AGENTS.md` line |
| Add or change an agent | Edit `.claude/agents/<name>.md` (and the OpenCode twin if one exists) |
| Add a skill | Create `.claude/skills/<name>/SKILL.md`; `name` in the frontmatter equals the directory name |
| Add a doc | Link it from [README.md](README.md) and, if assistants need it, from the table in `CLAUDE.md` |

Quick check:

```bash
wc -c AGENTS.md CLAUDE.md apps/*/AGENTS.md .claude/skills/*/SKILL.md
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Claude Code ignores a rule | Import broken | `CLAUDE.md` must start with `@AGENTS.md` |
| A rule exists only for one tool | Rule was put in `CLAUDE.md` | Move it to `AGENTS.md` |
| A relative link is dead | File moved or not yet created (target epics) | Fix the path; target files are named "created in E<n>" in prose, not linked |
| Subagent does git | Agent file lacks the "never git" rule | Restore it from `ops-dev`/`AGENTS.md`; only the main agent runs git |
