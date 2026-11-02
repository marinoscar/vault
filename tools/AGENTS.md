# tools rules

Root rules ([AGENTS.md](../AGENTS.md)) apply. `tools/` holds two npm workspaces (root `package.json` `workspaces: ["apps/*", "tools/*"]`).

## Layout (today)

- `tools/vaultcli` (`@vault/vaultcli`, bin `vaultcli`, `npm run vaultcli`): the **domain CLI**. `src/commands/`: `admin-backups`, `auth`, `backup`, `config`, `health`, `secrets`, `sync`, `types`, `versions`; `src/interactive/` (terminal menu), `src/lib/`, `src/utils/`, `src/version.ts`. Usage, install and flags: [vaultcli/README.md](vaultcli/README.md), the source of truth; `install.sh` installs it. Tests: `npm test -w tools/vaultcli` (tsc to `.test-dist`, then `node --test`).
- `tools/app` (`@vault/cli`, bin `app`, `npm run app`): the **generic template CLI** (allowlist, auth, config, docker, health, prisma, settings, storage, sync, test, users). Its README and `docs/` still say EnterpriseAppBase. Tests: Jest (`npm test -w tools/app`).
- Both need Node >=18 today.

## Rules

- **Target (E11):** both are replaced by one `vault` CLI on `createCli` of `@marinoscar/platform-cli` (the engine owns `init`, `login`, `api`, `config`, `node`, `deploy`, the TUI); Vault keeps only domain commands (secrets, versions, backup, admin-backups, sync) as `extraCommands`. Do not add a new generic command to `tools/app`; do not copy platform engine code.
- **The CLI never writes a secret value or a backup password to a log, and never saves a backup password itself** (`backup.json` records only where to read it: `passwordFile` or `passwordEnv`; the wizard's password file is `0600`). Its config files (`auth.json`, `sync.json`, `backup.json` in `~/.config/vaultcli/` or `$VAULTCLI_CONFIG_DIR`) are mode `0600`; keep that.
- **Server-rendered artifacts stay on the API**: export zips are produced by `POST /api/secrets/export` and `/api/admin/backups/export`; the CLI streams the response to a file and never re-renders (a second renderer would diverge).
- **Export responses are raw zip, not `{ data }`**; handle both shapes explicitly.
- Version: bump `tools/vaultcli/package.json` (and `src/version.ts` if it mirrors it) once per PR that improves the CLI; PATCH by default, MINOR for a new command; then `npm install --package-lock-only`.
- A behaviour change carries tests in the same or the next commit.

Run: `npm run vaultcli:build`, `npm test -w tools/vaultcli`, `npm run app:build`, `npm run typecheck -w tools/vaultcli`.
