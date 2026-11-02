> Frozen baseline. Produced 2026-11-02 by EnterpriseAppBase `scripts/platform-drift.mjs` (apps view) against Vault `1b2074d`; see [README.md](README.md) for how to regenerate it. Do not edit; a later re-run goes to a new file. Local absolute paths below are the generating machine's.

# Platform drift report

Generated 2026-11-02T03:43:48.502Z by `scripts/platform-drift.mjs` (schema 1).

| | Root | Commit |
|---|---|---|
| Base | `/home/user/EnterpriseAppBase` | `59e377cbebb60e711fe4d7b0d818715f23af8a59` |
| App | `/home/user/vault` | `1b2074ddce5215ad15a05ffc7ac5071505ea7dfc` |

## Identity replacements

Every value in this table, base or app, is replaced by its token on both sides before comparing, so these differences are ignored. A row marked "no" is unknown on one side and was not applied (pass the `--base-*`/`--app-*` flags).

| Placeholder | Base | App | Applied as |
|---|---|---|---|
| `__PRODUCT__` | `My App` | `Vault` | `__PRODUCT__` |
| `__SLUG__` | `my-app` | `vault` | `__SLUG__` |
| `__SLUG_SNAKE__` | `my_app` | `vault` | `__SLUG__` |
| `__SERVICE__` | `my-app-api` | `vault-api` | `__SERVICE__` |
| `__REPO_SLUG__` | `marinoscar/EnterpriseAppBase` | `marinoscar/vault` | `__REPO_SLUG__` |
| `__REPO_NAME__` | `EnterpriseAppBase` | `vault` | `__SLUG__` |
| `__CLI__` | `appctl` | `vault` | `__SLUG__` |
| `__CLI_UPPER__` | `APPCTL` | `VAULT` | `__CLI_UPPER__` |
| `__CLI_TITLE__` | `Appctl` | `Vault` | `__PRODUCT__` |

## Areas

"Identical" counts identical plus normalised-identical files over every base file in the area (present on both sides, or base-only).

| Area | Root | Base files | Identical | Normalised-identical | Modified | Base-only | App-only | Lines +/- | Identical to base |
|---|---|---|---|---|---|---|---|---|---|
| api | `apps/api/src` | 269 | 0 | 0 | 10 | 259 | 246 | +319 / -352 | 0% |
| api-test | `apps/api/test` | 369 | 12 | 0 | 21 | 336 | 3 | +149 / -1728 | 3.3% |
| web | `apps/web/src` | 273 | 11 | 0 | 40 | 222 | 153 | +4074 / -4527 | 4% |
| cli | `apps/cli/src` (not in app) | 302 | 0 | 0 | 0 | 302 | 0 | +0 / -0 | 0% |
| prisma | `apps/api/prisma` | 64 | 3 | 1 | 2 | 58 | 7 | +222 / -30 | 6.3% |
| infra | `infra` | 32 | 0 | 1 | 6 | 25 | 7 | +64 / -360 | 3.1% |
| stack-agent | `apps/stack-agent/src` (not in app) | 7 | 0 | 0 | 0 | 7 | 0 | +0 / -0 | 0% |
| android | `apps/android` (not in app) | 26 | 0 | 0 | 0 | 26 | 0 | +0 / -0 | 0% |
| packages | `packages` (not in app) | 3785 | 0 | 0 | 0 | 3785 | 0 | +0 / -0 | 0% |
| scripts | `scripts` | 16 | 1 | 0 | 1 | 14 | 0 | +20 / -23 | 6.3% |
| github | `.github` | 16 | 3 | 0 | 3 | 10 | 0 | +126 / -422 | 18.8% |

## Modules by changed lines

| Area | Module | Files | Modified | Base-only | App-only | Lines +/- | Identical to base |
|---|---|---|---|---|---|---|---|
| web | `__tests__` | 222 | 22 | 144 | 49 | +2276 / -3632 | 4% |
| web | `services` | 3 | 1 | 2 | 0 | +755 / -23 | 0% |
| web | `(root)` | 4 | 3 | 1 | 0 | +48 / -622 | 0% |
| api-test | `settings` | 16 | 2 | 14 | 0 | +49 / -613 | 0% |
| github | `workflows` | 9 | 2 | 7 | 0 | +102 / -403 | 0% |
| api-test | `fixtures` | 5 | 4 | 0 | 0 | +16 / -453 | 20% |
| web | `types` | 1 | 1 | 0 | 0 | +368 / -68 | 0% |
| api | `common` | 45 | 4 | 20 | 21 | +133 / -166 | 0% |
| api-test | `integration` | 6 | 1 | 5 | 0 | +0 / -266 | 0% |
| api | `(root)` | 5 | 3 | 2 | 0 | +152 / -105 | 0% |
| api-test | `storage` | 6 | 1 | 5 | 0 | +27 / -213 | 0% |
| prisma | `seed` | 3 | 1 | 2 | 0 | +217 / -15 | 0% |
| web | `hooks` | 24 | 2 | 6 | 15 | +199 / -20 | 11.1% |
| web | `components/navigation` | 5 | 2 | 2 | 1 | +175 / -26 | 0% |
| infra | `otel` | 3 | 1 | 1 | 1 | +16 / -182 | 0% |
| infra | `compose` | 16 | 4 | 10 | 1 | +38 / -96 | 6.7% |
| web | `components/home` | 6 | 1 | 0 | 5 | +41 / -57 | 0% |
| web | `theme` | 4 | 3 | 0 | 1 | +76 / -17 | 0% |
| infra | `nginx` | 15 | 1 | 13 | 1 | +10 / -82 | 0% |
| api-test | `auth` | 11 | 3 | 7 | 1 | +29 / -52 | 0% |
| api | `config` | 2 | 1 | 1 | 0 | +31 / -44 | 0% |
| web | `components/common` | 6 | 1 | 0 | 3 | +34 / -34 | 66.7% |
| web | `contexts` | 2 | 1 | 0 | 1 | +56 / -8 | 0% |
| web | `pages` | 27 | 2 | 2 | 23 | +41 / -15 | 0% |
| api-test | `mocks` | 6 | 2 | 1 | 1 | +4 / -42 | 40% |
| github | `(root)` | 3 | 1 | 1 | 0 | +24 / -19 | 33.3% |
| scripts | `(root)` | 16 | 1 | 14 | 0 | +20 / -23 | 6.3% |
| api-test | `helpers` | 12 | 3 | 8 | 0 | +5 / -36 | 8.3% |
| api | `prisma` | 11 | 2 | 9 | 0 | +3 / -37 | 0% |
| api-test | `errors` | 1 | 1 | 0 | 0 | +2 / -31 | 0% |
| prisma | `(root)` | 4 | 1 | 1 | 1 | +5 / -15 | 33.3% |
| api-test | `health` | 1 | 1 | 0 | 0 | +6 / -7 | 0% |
| api-test | `rbac` | 4 | 1 | 2 | 0 | +7 / -6 | 25% |
| web | `components/user` | 1 | 1 | 0 | 0 | +5 / -5 | 0% |
| api-test | `test-auth` | 1 | 1 | 0 | 0 | +0 / -8 | 0% |
| api-test | `(root)` | 16 | 1 | 9 | 0 | +4 / -1 | 37.5% |
| android | `(root)` | 7 | 0 | 7 | 0 | +0 / -0 | 0% |
| android | `app` | 15 | 0 | 15 | 0 | +0 / -0 | 0% |
| android | `gradle` | 3 | 0 | 3 | 0 | +0 / -0 | 0% |
| android | `scripts` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| api | `ai` | 32 | 0 | 0 | 32 | +0 / -0 | n/a |
| api | `allowlist` | 8 | 0 | 0 | 8 | +0 / -0 | n/a |
| api | `app-registrations` | 21 | 0 | 21 | 0 | +0 / -0 | 0% |
| api | `auth` | 28 | 0 | 0 | 28 | +0 / -0 | n/a |
| api | `backups` | 28 | 0 | 0 | 28 | +0 / -0 | n/a |
| api | `device-auth` | 16 | 0 | 0 | 16 | +0 / -0 | n/a |
| api | `doctor` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| api | `examples` | 30 | 0 | 30 | 0 | +0 / -0 | 0% |
| api | `health` | 5 | 0 | 0 | 5 | +0 / -0 | n/a |
| api | `identity-extensions` | 6 | 0 | 6 | 0 | +0 / -0 | 0% |
| api | `jobs` | 2 | 0 | 2 | 0 | +0 / -0 | 0% |
| api | `media` | 9 | 0 | 0 | 9 | +0 / -0 | n/a |
| api | `onboarding` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| api | `openapi` | 5 | 0 | 5 | 0 | +0 / -0 | 0% |
| api | `pat` | 8 | 0 | 0 | 8 | +0 / -0 | n/a |
| api | `platform` | 89 | 0 | 89 | 0 | +0 / -0 | 0% |
| api | `platform-extensions` | 64 | 0 | 64 | 0 | +0 / -0 | 0% |
| api | `secret-types` | 9 | 0 | 0 | 9 | +0 / -0 | n/a |
| api | `secrets` | 26 | 0 | 0 | 26 | +0 / -0 | n/a |
| api | `settings` | 21 | 0 | 8 | 13 | +0 / -0 | 0% |
| api | `storage` | 25 | 0 | 0 | 25 | +0 / -0 | n/a |
| api | `test-auth` | 7 | 0 | 0 | 7 | +0 / -0 | n/a |
| api | `users` | 11 | 0 | 0 | 11 | +0 / -0 | n/a |
| api-test | `about` | 2 | 0 | 2 | 0 | +0 / -0 | 0% |
| api-test | `ai` | 21 | 0 | 21 | 0 | +0 / -0 | 0% |
| api-test | `alerts` | 3 | 0 | 3 | 0 | +0 / -0 | 0% |
| api-test | `android-app` | 4 | 0 | 4 | 0 | +0 / -0 | 0% |
| api-test | `broadcasts` | 5 | 0 | 5 | 0 | +0 / -0 | 0% |
| api-test | `conformance` | 2 | 0 | 2 | 0 | +0 / -0 | 0% |
| api-test | `credentials` | 5 | 0 | 5 | 0 | +0 / -0 | 0% |
| api-test | `db-backup` | 10 | 0 | 10 | 0 | +0 / -0 | 0% |
| api-test | `device-auth` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| api-test | `doctor` | 5 | 0 | 5 | 0 | +0 / -0 | 0% |
| api-test | `email` | 2 | 0 | 2 | 0 | +0 / -0 | 0% |
| api-test | `event-bus` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| api-test | `examples` | 67 | 0 | 67 | 0 | +0 / -0 | 0% |
| api-test | `exports` | 3 | 0 | 3 | 0 | +0 / -0 | 0% |
| api-test | `identity` | 2 | 0 | 2 | 0 | +0 / -0 | 0% |
| api-test | `jobs` | 18 | 0 | 18 | 0 | +0 / -0 | 0% |
| api-test | `maintenance` | 2 | 0 | 2 | 0 | +0 / -0 | 0% |
| api-test | `nodes` | 15 | 0 | 15 | 0 | +0 / -0 | 0% |
| api-test | `notifications` | 43 | 0 | 43 | 0 | +0 / -0 | 0% |
| api-test | `onboarding` | 4 | 0 | 4 | 0 | +0 / -0 | 0% |
| api-test | `openapi` | 3 | 0 | 3 | 0 | +0 / -0 | 0% |
| api-test | `organizations` | 5 | 0 | 5 | 0 | +0 / -0 | 0% |
| api-test | `platform` | 7 | 0 | 7 | 0 | +0 / -0 | 0% |
| api-test | `prisma` | 14 | 0 | 14 | 0 | +0 / -0 | 0% |
| api-test | `retention` | 2 | 0 | 2 | 0 | +0 / -0 | 0% |
| api-test | `secrets` | 1 | 0 | 0 | 1 | +0 / -0 | n/a |
| api-test | `sharing` | 12 | 0 | 12 | 0 | +0 / -0 | 0% |
| api-test | `telemetry` | 11 | 0 | 11 | 0 | +0 / -0 | 0% |
| api-test | `tenancy` | 8 | 0 | 8 | 0 | +0 / -0 | 0% |
| api-test | `user-data` | 6 | 0 | 6 | 0 | +0 / -0 | 0% |
| api-test | `webhooks` | 2 | 0 | 2 | 0 | +0 / -0 | 0% |
| cli | `(root)` | 39 | 0 | 39 | 0 | +0 / -0 | 0% |
| cli | `commands` | 10 | 0 | 10 | 0 | +0 / -0 | 0% |
| cli | `deploy` | 135 | 0 | 135 | 0 | +0 / -0 | 0% |
| cli | `init` | 3 | 0 | 3 | 0 | +0 / -0 | 0% |
| cli | `node` | 66 | 0 | 66 | 0 | +0 / -0 | 0% |
| cli | `tui` | 49 | 0 | 49 | 0 | +0 / -0 | 0% |
| github | `ISSUE_TEMPLATE` | 4 | 0 | 2 | 0 | +0 / -0 | 50% |
| infra | `(root)` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| infra | `deploy` | 4 | 0 | 0 | 4 | +0 / -0 | n/a |
| packages | `(root)` | 4 | 0 | 4 | 0 | +0 / -0 | 0% |
| packages | `platform-ai-providers` | 101 | 0 | 101 | 0 | +0 / -0 | 0% |
| packages | `platform-api` | 1838 | 0 | 1838 | 0 | +0 / -0 | 0% |
| packages | `platform-cli` | 398 | 0 | 398 | 0 | +0 / -0 | 0% |
| packages | `platform-contract` | 166 | 0 | 166 | 0 | +0 / -0 | 0% |
| packages | `platform-db` | 157 | 0 | 157 | 0 | +0 / -0 | 0% |
| packages | `platform-infra` | 113 | 0 | 113 | 0 | +0 / -0 | 0% |
| packages | `platform-web` | 1003 | 0 | 1003 | 0 | +0 / -0 | 0% |
| packages | `shared` | 5 | 0 | 5 | 0 | +0 / -0 | 0% |
| prisma | `catalog` | 3 | 0 | 3 | 0 | +0 / -0 | 0% |
| prisma | `fragments` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| prisma | `migrations` | 46 | 0 | 38 | 5 | +0 / -0 | 7.3% |
| prisma | `schema.prisma` | 14 | 0 | 13 | 1 | +0 / -0 | 0% |
| stack-agent | `(root)` | 7 | 0 | 7 | 0 | +0 / -0 | 0% |
| web | `components/admin` | 8 | 0 | 0 | 8 | +0 / -0 | n/a |
| web | `components/auth` | 1 | 0 | 0 | 1 | +0 / -0 | n/a |
| web | `components/cards` | 8 | 0 | 0 | 8 | +0 / -0 | n/a |
| web | `components/device-activation` | 3 | 0 | 0 | 3 | +0 / -0 | n/a |
| web | `components/media` | 3 | 0 | 0 | 3 | +0 / -0 | n/a |
| web | `components/secret-types` | 5 | 0 | 0 | 5 | +0 / -0 | n/a |
| web | `components/secrets` | 8 | 0 | 0 | 8 | +0 / -0 | n/a |
| web | `components/settings` | 11 | 0 | 0 | 11 | +0 / -0 | n/a |
| web | `config` | 5 | 0 | 5 | 0 | +0 / -0 | 0% |
| web | `identity` | 3 | 0 | 3 | 0 | +0 / -0 | 0% |
| web | `jobs` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| web | `nodes` | 1 | 0 | 1 | 0 | +0 / -0 | 0% |
| web | `pages/Admin` | 4 | 0 | 4 | 0 | +0 / -0 | 0% |
| web | `platform` | 12 | 0 | 12 | 0 | +0 / -0 | 0% |
| web | `platform-extensions` | 38 | 0 | 38 | 0 | +0 / -0 | 0% |
| web | `utils` | 10 | 0 | 1 | 8 | +0 / -0 | 50% |

## Most changed files (top 50)

| File | Lines +/- |
|---|---|
| `apps/web/src/__tests__/components/admin/UserList.test.tsx` | +549 / -320 |
| `apps/web/src/services/api.ts` | +755 / -23 |
| `apps/web/src/__tests__/components/admin/AllowlistTable.test.tsx` | +492 / -204 |
| `apps/web/src/App.tsx` | +48 / -611 |
| `apps/web/src/__tests__/App.test.tsx` | +16 / -578 |
| `apps/web/src/__tests__/components/home/QuickActions.test.tsx` | +88 / -503 |
| `apps/web/src/__tests__/components/settings/PersonalAccessTokens.test.tsx` | +395 / -160 |
| `apps/web/src/__tests__/components/common/Layout.test.tsx` | +368 / -133 |
| `apps/web/src/__tests__/pages/HomePage.test.tsx` | +167 / -325 |
| `apps/web/src/types/index.ts` | +368 / -68 |
| `.github/workflows/ci.yml` | +32 / -399 |
| `apps/api/test/settings/system-settings.integration.spec.ts` | +29 / -399 |
| `apps/web/src/__tests__/mocks/handlers.ts` | +20 / -396 |
| `apps/api/test/fixtures/test-data.factory.ts` | +4 / -406 |
| `apps/api/test/integration/device-auth.integration.spec.ts` | +0 / -266 |
| `apps/api/test/storage/storage.integration.spec.ts` | +27 / -213 |
| `apps/api/test/settings/user-settings.integration.spec.ts` | +20 / -214 |
| `apps/api/prisma/seed.ts` | +217 / -15 |
| `infra/otel/otel-collector-config.yaml` | +16 / -182 |
| `apps/api/src/common/schemas/settings.schema.ts` | +32 / -143 |
| `apps/web/src/__tests__/components/navigation/AppBar.test.tsx` | +7 / -168 |
| `apps/web/src/__tests__/setup.ts` | +33 / -122 |
| `apps/web/src/__tests__/components/navigation/UserMenu.test.tsx` | +13 / -139 |
| `apps/web/src/__tests__/services/api.test.ts` | +1 / -140 |
| `apps/web/src/__tests__/utils/test-utils.tsx` | +7 / -133 |
| `apps/web/src/__tests__/contexts/AuthContext.test.tsx` | +4 / -127 |
| `apps/web/src/hooks/useSystemSettings.ts` | +115 / -7 |
| `apps/web/src/components/navigation/UserMenu.tsx` | +107 / -13 |
| `apps/api/src/app.module.ts` | +52 / -58 |
| `apps/web/src/components/home/QuickActions.tsx` | +41 / -57 |
| `apps/web/src/hooks/useUserSettings.ts` | +84 / -13 |
| `apps/web/src/__tests__/hooks/useUsers.test.ts` | +47 / -49 |
| `infra/nginx/nginx.conf` | +10 / -82 |
| `apps/web/src/components/navigation/AppBar.tsx` | +68 / -13 |
| `apps/api/src/main.ts` | +36 / -40 |
| `apps/api/src/config/configuration.ts` | +31 / -44 |
| `.github/workflows/deploy.yml` | +70 / -4 |
| `apps/api/src/instrumentation.ts` | +64 / -7 |
| `apps/web/src/__tests__/hooks/useSystemSettings.test.ts` | +41 / -30 |
| `apps/web/src/components/common/Layout.tsx` | +34 / -34 |
| `apps/api/src/common/types/settings.types.ts` | +60 / -4 |
| `apps/web/src/contexts/ThemeContext.tsx` | +56 / -8 |
| `apps/web/src/__tests__/hooks/useUserSettings.test.ts` | +7 / -54 |
| `infra/compose/.env.example` | +14 / -43 |
| `apps/api/src/common/constants/roles.constants.ts` | +37 / -16 |
| `apps/web/src/pages/HomePage.tsx` | +39 / -13 |
| `apps/web/src/theme/index.ts` | +34 / -10 |
| `.github/pull_request_template.md` | +24 / -19 |
| `scripts/dev.ps1` | +20 / -23 |
| `infra/compose/base.compose.yml` | +20 / -22 |

## Migrations

Matched by normalised SQL first, then by the name after the 14-digit timestamp.

| Base | App | Shared | Renamed | Same name, different SQL | Base-only | App-only |
|---|---|---|---|---|---|---|
| 40 | 7 | 2 | 0 | 0 | 38 | 5 |

Base-only:

- `20260830211041_add_credentials`
- `20260831010356_add_notification_deliveries`
- `20260831014110_drop_stale_uuid_defaults`
- `20260831030721_add_notifications`
- `20260905182958_add_push_subscriptions`
- `20260906120000_add_jobs`
- `20260906190000_add_worker_nodes`
- `20260907120000_add_database_backup_runs`
- `20260907130000_add_notification_broadcasts`
- `20260907140000_add_backup_run_job_link`
- `20260907150000_add_job_node_secrets`
- `20260907160000_add_backup_run_pg_dump_version`
- `20260908120000_add_job_claim_token`
- `20260926034919_add_ai_platform`
- `20260927000000_revoke_viewer_ai_use`
- `20260927120000_add_user_credentials`
- `20260927130000_add_device_session_credential_link`
- `20260928100000_add_worker_node_vitals`
- `20260930120000_add_job_trace_context`
- `20261006120000_add_retention_created_at_indexes`
- `20261007141244_add_organizations`
- `20261007161956_split_system_org_roles`
- `20261007202337_org_scoped_rls`
- `20261007222406_add_groups`
- `20261008000859_add_grants`
- `20261008012052_add_org_settings`
- `20261008041856_add_org_credentials`
- `20261008052119_add_jobs_org_id`
- `20261008052120_add_jobs_org_id_status_index`
- `20261008080749_add_broadcast_target_org`
- `20261008120000_add_android_app`
- `20261013115831_open_job_reason`
- `20261013154013_ai_usage_feature`
- `20261013195500_add_app_metadata`
- `20261013214001_open_sharing_vocabularies`
- `20261101003924_add_worker_node_events`
- `20261101044654_add_webhooks`
- `20261101050011_add_alerts`

App-only:

- `20260403120000_add_secrets_and_versions`
- `20260403235813_add_media_folders`
- `20260404000000_add_secret_name_user_unique`
- `20260727120000_version_scoped_attachments`
- `20261102120000_add_backup_schedules`

## Prisma models

Base models present in the app: 15 of 46. Total models in the app: 22.

- Missing from the app: `AiModel`, `AiRun`, `AiUsageEvent`, `AlertIncident`, `AlertRule`, `AndroidAppRelease`, `Credential`, `DatabaseBackupRun`, `Grant`, `Group`, `GroupInvite`, `GroupMember`, `Invite`, `Job`, `JobNodeSecret`, `JobStatsRollup`, `Membership`, `NodeCredential`, `Notification`, `NotificationBroadcast`, `NotificationDelivery`, `OrgCredential`, `OrgSettings`, `Organization`, `PushSubscription`, `UserAiKey`, `UserCredential`, `WebhookDelivery`, `WebhookEndpoint`, `WorkerNode`, `WorkerNodeEvent`
- App-only: `BackupRun`, `BackupSchedule`, `MediaFolder`, `Secret`, `SecretAttachment`, `SecretType`, `SecretVersion`

Shared models whose fields differ:

| Model | Fields added in the app | Fields removed in the app |
|---|---|---|
| `AuditEvent` | none | `org`, `orgId` |
| `DeviceCode` | none | `collectedAt`, `credentialExpiresAt`, `org`, `orgId`, `pat`, `patId`, `refreshTokens`, `revokedAt` |
| `Permission` | none | `scope` |
| `PersonalAccessToken` | none | `deviceCodes`, `org`, `orgId` |
| `RefreshToken` | none | `deviceCode`, `deviceCodeId`, `org`, `orgId` |
| `Role` | none | `invites`, `memberships`, `scope` |
| `StorageObject` | `mediaFolder`, `mediaFolderId`, `secretAttachments` | `org`, `orgId` |
| `StorageObjectChunk` | none | `org`, `orgId` |
| `User` | `backupRunsOwned`, `backupRunsTriggered`, `backupSchedulesUpdated`, `mediaFolders`, `secretTypes`, `secretVersions`, `secrets` | `aiKeys`, `aiModelsUpdated`, `aiRuns`, `aiUsageEvents`, `androidAppReleases`, `broadcastsCreated`, `credentialUpdates`, `databaseBackupRuns`, `databaseRestores`, `grantsGiven`, `grantsReceived`, `grantsRevoked`, `groupInvitesClaimed`, `groupInvitesSent`, `groupMembersAdded`, `groupMemberships`, `groupsCreated`, `invitesAccepted`, `invitesSent`, `memberships`, `metadata`, `nodeCredentials`, `notificationDeliveries`, `notifications`, `orgCredentialUpdates`, `orgSettingsUpdates`, `organizationsCreated`, `pushSubscriptions`, `userCredentials`, `webhookEndpoints`, `workerNodes` |

## Zero-drift modules

Modules where every file exists on both sides and is identical or normalised-identical: the candidates for early adoption.

- api-test: `users` (1 files)
