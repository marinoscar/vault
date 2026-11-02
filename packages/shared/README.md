# `@app/shared`

Vault's product identity, read by the platform tooling (`platform-cli`, `platform-infra sync`, the drift report, `scripts/rename.mjs`) and, from E3 on, by the API, the web app and the CLI.

| Export | Source |
|---|---|
| `APP_NAME` | `identity.json` → `productName` |
| `THEME_COLOR` | `identity.json` → `themeColor` (Vault deep teal, see `docs/specs/ux-refresh.md`) |
| `BACKGROUND_COLOR` | `identity.json` → `backgroundColor` |
| `REPO_SLUG`, `REPO_URL` | `identity.json` → `repoSlug` |
| `APP_SLUG` | derived from `APP_NAME` |
| `CLI_NAME` | `identity.json` → `cliName` |
| `ANDROID_IDENTITY_SOURCE` | `productName`, `repoSlug`, optional `android` block |

`identity.json` also carries `cliName` (`vault`), the binary name the platform CLI uses from E11.

Plain CommonJS with a hand-written `index.d.ts`, so nothing needs building (same as EnterpriseAppBase's `packages/shared`). Change identity with the [`rename-app` skill](../../.claude/skills/rename-app/SKILL.md), never by hand-editing call sites.
