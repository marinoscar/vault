# apps/cli rules

Root rules ([AGENTS.md](../../AGENTS.md)) apply. This file is what to get right when editing the `vault` CLI. Usage, install, flags, environment variables, scheduling and the `vaultcli` migration table: [README.md](README.md), the source of truth; do not restate it elsewhere.

## Layout

- The engine is **`@marinoscar/platform-cli`** (pinned in `package.json`): the `init`, `login` (device flow), `api`, `config`, `node` and `deploy` commands, the ink TUI, the VPS deploy pipeline and the worker-node engine. `src/` holds only what the platform does not have; **never copy an engine file** into this package.
- `src/app.ts`: `APP_CLI_OPTIONS` (identity from `@app/shared`, `readVersion()`, `extraCommands`, `deploy.versionedManifests`, the update notice). `src/cli.ts`: the entry point. `src/run.ts`: one invocation.
- `src/vault/`: Vault's domain commands, registered as `extraCommands` through `src/vault/register.ts` (`secrets`, `versions`, `types`, `health`, `sync`, `backup` incl. `prune` and `config`, `admin backups`, `auth`, `menu`). `lib/` is the API client, backup runner, settings, retention and sync engine; `interactive/` is `vault menu`; `utils/config.ts` is the one place that reads the server URL, the token and the state-file locations.
- The CLI is a workspace package (`--workspace=cli`), built from this monorepo and not published. CLI environment variables take the `VAULT_` prefix (the platform's rule, from `cliName` in `packages/shared/identity.json`); the pre-rename `VAULTCLI_SERVER_URL`, `VAULTCLI_CONFIG_DIR` and `VAULTCLI_BACKUP_PASSWORD` are still read. Never rename or drop those without a deprecation note in the README.
- Extend the CLI through the platform's registries (`extraCommands`, `deploySteps`, `deployChecks`, `nodeExecutors`, `proxy.streamPaths`, `tuiScreens`), not by editing a platform file. A platform gap is a `seam_request.yml` issue on EnterpriseAppBase, recorded in [local-exceptions](../../docs/platform-adoption/local-exceptions.md).
- A new command group is a `register*Command(program)` function in `src/vault/commands/`, added to `vaultCommands` in `register.ts` (which gives it `--json`, `-q`, `--server`, `--no-color`, `-v`) and to `VAULT_COMMAND_NAMES`. A name taken by a platform command (`init`, `login`, `api`, `config`, `node`, `deploy`, `help`) throws at `createCli`.

## Version bump (root rule: CLI version bump on improvement)

- The version lives **only** in `apps/cli/package.json` (today `2.0.0`: major because the binary was renamed from `vaultcli`). `readVersion()` in `src/version.ts` reads it at runtime; never hardcode it or import `package.json` elsewhere.
- PATCH for an improvement or a set shipped together; MINOR for a new command or subcommand; **one bump per PR**, not per commit. Then run `npm install --package-lock-only` so the lockfile's `apps/cli` entry carries the version; the bump is incomplete without it.
- The version is recorded in deployment state and sent as the User-Agent on every API request. The deploy version step versions `apps/api`, `apps/web` and `packages/shared` only (`deploy.versionedManifests`), so it never touches this package.
- Applies to `apps/cli` and `apps/cli/install.sh`. Adding only docs such as this file is not a CLI improvement.

## Rules

- **The CLI never writes a secret value or a backup password to a log, and never saves a backup password itself** (`backup.json` records only where to read it: `passwordFile` or `passwordEnv`; the menu's password file is `0600`). Its state files (`sync.json`, `backup.json`, `backup-password`) and the platform's `~/.vault/config.json` are mode `0600`; keep that. The token goes only in `Authorization: Bearer`.
- **Server-rendered artifacts stay on the API**: export zips are produced by `POST /api/secrets/export` and `/api/admin/backups/export`; the CLI streams the response to a file and never re-renders (a second renderer would diverge).
- **Export responses are raw zip, not `{ data }`**; handle both shapes explicitly.
- Sign-in is the platform's `login`; do not re-add a token-paste `auth login`. `vault auth login` only points at it.
- `parseEnvExample` of the platform reads any commented `# KEY=value` line of `infra/compose/.env.example` as a declared variable; never add one.
- A behaviour change carries tests in the same or the next commit (Vitest, `src/**/*.test.ts`).

Run: `npm run build --workspace=cli`, `npm run typecheck --workspace=cli`, `npm run test:run --workspace=cli`.
