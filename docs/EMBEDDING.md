# Embedding the Vault packages in another host

How an EnterpriseAppBase (EAB) app that is not Vault mounts the Vault domain: `@marinoscar/vault-api` (the NestJS slices behind ports), `@marinoscar/vault-db` (the schema fragments and migrations), `@marinoscar/vault-web` (the React slices) and `@marinoscar/vault-contract` (the wire schemas). Issue #194, epic #191.

Every step here is exercised by **Host Beta**, the fixture host in [`tests/second-host/`](../tests/second-host/README.md): its own identity (`Host Beta`, slug `hostbeta`), roles, schema, migration history and a binding for every port. CI runs it against a real PostgreSQL 16 (job `second-host` of `.github/workflows/ci.yml`). When a step changes, the fixture changes with it.

## Contents

- [The steps, and where the fixture does each](#the-steps-and-where-the-fixture-does-each)
- [Install](#install)
- [What a host provides: the ports](#what-a-host-provides-the-ports)
- [Registrations: roles, permissions, models, OAuth](#registrations-roles-permissions-models-oauth)
- [Database](#database)
- [Names the packages own](#names-the-packages-own)
- [Web slices](#web-slices)
- [Security responsibilities that move to the host](#security-responsibilities-that-move-to-the-host)
- [Calling the agent rules in process](#calling-the-agent-rules-in-process)
- [The host conformance kit](#the-host-conformance-kit)
- [Not supported when embedded](#not-supported-when-embedded)
- [Upgrade procedure](#upgrade-procedure)

## The steps, and where the fixture does each

| Step | Host Beta |
|---|---|
| 1. Install the packages | resolves the workspace build (`npm ci && npm run build:packages`); a real host installs from npm |
| 2. Register roles, permissions (Vault's mapped onto the host's roles), the model classification, the agent OAuth resource | `api/src/permissions.ts`, `api/src/registrations.ts` |
| 3. Install the schema and the migrations: `platform db sync`, `vault-db sync --names stable`, the host's own fragment and migration, `platform db compose` | `api/prisma/` (committed), `npm run db:sync`, `npm run db:check` |
| 4. Generate the host's own Prisma client | `prisma generate --generator hostbeta` (`api/prisma/fragments/host.beta.prisma`) |
| 5. Migrate as the ordinary role, check the raw-SQL objects, seed | `api/test/host-database.ts`: `prisma migrate deploy`, `vault-db check --database`, `seedPlatform`, `seedVaultSystemSecretTypes` |
| 6. Bind every port and mount `VaultApiModule.forRoot` | `api/src/vault-bindings.ts`, `api/src/app.module.ts` |
| 7. Check the names do not collide | `findVaultNameCollisions` through the kit (`hostNames`) |
| 8. Mount the web slices under the host's brand and navigation, configure `vault-web` once | `web/src/HostBetaApp.tsx` |
| 9. Run the host conformance kit | `api/test/api.smoke.spec.ts` (`runVaultHostConformance`, with `inProcessAgent`) and `web/test/web.smoke.test.tsx` |
| 10. Optionally, let the host's own agent call the release rules in process (no OAuth) | `api/test/api.smoke.spec.ts`, "Host Beta calls the agent rules in process" |

## Install

```bash
npm install @marinoscar/vault-api@next @marinoscar/vault-contract@next @marinoscar/vault-web@next
npm install --save-dev @marinoscar/vault-db@next
```

The peers are the platform packages at the version the Vault packages were built against (see each package README, "Install and peer dependencies"), NestJS 11, Prisma 7, React 19 and MUI 9. The packages import nothing of Vault's apps.

## What a host provides: the ports

`VaultApiModule.forRoot({ bindings, imports })` takes one binding per port (`useClass`, `useExisting`, `useValue` or `useFactory`). A missing required port fails the boot naming its token. Interfaces: `@marinoscar/vault-api/ports`.

| Port (binding key) | Interface | What a correct binding guarantees | Host Beta |
|---|---|---|---|
| `VAULT_PRISMA` (`prisma`) | the host's generated `PrismaClient` | Generated from the composed schema (platform + `vault-db` + host); connects as the ordinary role (`NOSUPERUSER NOBYPASSRLS`) so row-level security applies; has `runInOrg` / `forOrg` for the platform slices | `PrismaService` over its own client in `api/generated/client` |
| `VAULT_CRYPTO` (`crypto`) | `VaultCryptoPort`: `encrypt(plaintext)`, `decrypt(ciphertext, iv, authTag)` | **Authenticated** encryption (AES-256-GCM or equivalent: `decrypt` throws when the tag does not verify); a fresh IV per call; the key from the host's secret store, never from code; **key rotation** possible without losing old rows (a key id carried in the ciphertext, or a rehearsed re-encryption on a restored copy); a plaintext or a key is never logged, returned in an error or persisted | `HostBetaCipher`: a key ring `HOST_BETA_DATA_KEYS` (`kid:base64,...`), the key id in the ciphertext (`k1.<base64>`); not `VAULT_ENCRYPTION_KEY` |
| `VAULT_OBJECT_STORE` (`objectStore`) | `VaultObjectStorePort` (the raw provider: `upload`, `download`, `delete`, `exists`, `getBucket`, `getSignedDownloadUrl`) | Streams (an archive is never buffered by the slices; the provider should not either); deleting an orphaned blob has no uploader check | in memory (`HostBetaObjectStore`); a real host binds the platform storage slice's `STORAGE_PROVIDER` |
| `VAULT_OBJECTS` (`objects`) | `VaultObjectsPort`: `delete`, `getDownloadUrl` | Enforces that the user uploaded the object (unless `canDeleteAny`) in the given organization | `HostBetaObjects` |
| `VAULT_JOBS` (`jobs`) | `VaultJobsPort`: `enqueue`, `enqueueWithin`, `registerHandler` | The platform queue; the four handlers (`vault.*`) register in `onModuleInit`; they are server-only (never offloaded to a worker node: they decrypt) | `HostBetaJobs` over `JobsService` + `JobHandlerRegistry` |
| `VAULT_NOTIFY` (`notify`) | `VaultNotifyPort`: `notify`, `notifyNow`, `notifyPermissionHolders`, `notifyCounted` | Called after the triggering write commits; never rejects into the caller. With the platform notifications slice, the host registers the nine `vault.*` events and their templates | `HostBetaNotifier` records and logs the event key (no notifications slice) |
| `VAULT_AI`, `VAULT_AI_CONFIG`, `VAULT_AI_KEY_PRESENCE` (`ai`, `aiConfig`, `aiKeyPresence`) | `forUser`, `describePublic`, `isConfigured` | Server-side only, under a key the platform resolved for the call; the card CVV is never sent. The card-scan route also carries the platform's `AiEnabledGuard`, which injects `AiConfigService`: import the platform AI module, or provide a stand-in that refuses | "no AI": the ports refuse, `HostBetaNoAiModule` provides a refusing `AiConfigService` (403 `AI_DISABLED`) |
| `VAULT_AUDIT` (`audit`) | `VaultAuditPort`: `record(event)` | One row per call **in the platform's `audit_events` table** (the agent activity page and two job dedups read it back through `VAULT_PRISMA`); a write failure is **not swallowed** by the binding: it propagates, and the few slices that must not fail on it catch it themselves | `HostBetaAudit` |
| `VAULT_SETTINGS` (`settings`) | `VaultSettingsPort`: `getNamespace(name)`, `getSettings()` | Answers the namespaces `vaultCards`, `vaultBackups`, `agentAccess` (and the platform's `ai`) with their defaults applied; the shapes and defaults are `VaultCardsSettings`, `VaultBackupsSettings` (`@marinoscar/vault-api/core`) and `AgentAccessSettings` (`@marinoscar/vault-contract/agent`) | `HostBetaVaultSettings`: the host's own store, agent access on. Vault instead registers the three namespaces with the platform settings slice (`apps/api/src/app-registrations/settings.ts`) and binds the platform's `SystemSettingsService` |
| `VAULT_METRICS` (`metrics`, optional) | `VaultMetricsPort` | The host names the instruments; labels are the low-cardinality lists of `core/metric-labels`. Keep the `vault` segment out of the host's own names (it is the packages'); Vault names them `app.vault.*` | `HostBetaMetrics` (`app.beta.secrets.created`, ...) |
| `VAULT_MCP_OPTIONS` (`mcp`, optional) | `VaultMcpOptions` | `appUrl`: the one origin the MCP Origin rule admits | `{ appUrl: 'https://host.example.test' }` |
| `VAULT_HOST` (`host`, optional) | `VaultHostConfig`: `{ appUrl }` | The public base URL of the notification links. The packages read **no** environment variable | `{ appUrl: 'https://host.example.test' }` |

## Registrations: roles, permissions, models, OAuth

Called once at import time, before the app boots (the platform registries freeze at bootstrap):

- **Permissions on the host's roles.** `registerPlatformPermissions({ slices, app: { roles: [HOST_ROLES], permissions: [HOST_PERMISSIONS, vaultPermissionDeclarations(mapping)] } })`. `vaultPermissionDeclarations` keeps every id, description and scope and moves Vault's default grants (`admin`, `org_admin`, `contributor`, `viewer`) onto the host's roles: Host Beta maps `contributor` to `beta_editor` and `viewer` to `beta_reader`. Pass the same options to `platformPermissionCatalog()` in the seed. The `*_any` permissions are system-scoped and stay on `admin` unless mapped. The Vault routes also enforce platform permissions: `system_settings:read` (administrator backups; `settings` slice) and `ai:use` (card scanning; `ai` slice): list those slices when you mount those features.
- **Model classification.** `registerPlatformUserOwnedModels(VAULT_USER_OWNED_MODELS)` and `registerPlatformModelOwnership(VAULT_MODEL_OWNERSHIP)` (`@marinoscar/vault-api/core`), next to the host's own models.
- **Agent OAuth.** `registerVaultAgentOAuth()` (`/agent`) registers the scopes `vault:items_*`, `vault:cards_*` and `vault:identity_*` and the `agent` protected resource; `registerVaultMcpOAuth()` (`/mcp`) the `mcp` one. Agents can also use personal access tokens (`pat_`), which is what Host Beta does over HTTP. An agent inside the host's own process needs neither ([Calling the agent rules in process](#calling-the-agent-rules-in-process)).
- **Settings namespaces**, only if `VAULT_SETTINGS` reads the platform settings: register `vaultCards`, `vaultBackups` and `agentAccess` (Vault's declarations in `apps/api/src/app-registrations/settings.ts` are the reference) before `SettingsModule.forRoot()`.

## Database

The domain tables reference the platform's `users`, `organizations`, `storage_objects` and `jobs`, so the platform history runs first, then the domain's, then the host's own.

```bash
platform db sync --timestamp 2024-01-01T00:00:00Z   # the platform migrations, named before the domain's (dated 2026)
vault-db sync --names stable                         # prisma/fragments/vault.*.prisma, prisma/migrations/<ts>_vault_<slug>, prisma/vault.lock
# add the host's own fragment(s) and migration(s), dated after the domain's
platform db compose                                  # prisma/schema/ (generated)
prisma generate                                      # the host's client
platform db compose --check && platform db check && vault-db check   # CI
DATABASE_URL=... prisma migrate deploy               # as the ordinary role
DATABASE_URL=... vault-db check --database           # the raw-SQL index secret_versions_current_unique exists
```

- `--names stable` names a domain migration `<its own timestamp>_vault_<slug>`, a pure function of the migration: upgrades only append names. Vault's own app keeps `original` names because its databases already ran them.
- **The lock files.** `prisma/platform.lock` (the platform's, extended by `vault-db sync` with the domain's raw-SQL index and its `appMigrations`) and `prisma/vault.lock` (each domain migration's installed name and sha256). Commit both.
- **Never edit**: an installed `migration.sql` (platform or domain; comments count toward the hash), a generated `prisma/fragments/vault.*.prisma`, or `prisma/schema/`. Do not run `prisma format` on them. A host change is a new fragment of its own and a new migration of its own; a back-relation onto a platform or domain model is an `extend model` block in the host's fragment.
- **Generator.** If the repository also generates another client into `node_modules`, give the host its own generator with an `output` (Host Beta: `generator hostbeta`, `prisma generate --generator hostbeta`).
- **The role.** The application connects as an ordinary role that owns the tables (`NOSUPERUSER NOBYPASSRLS`); row-level security is inert for a superuser.
- **The seed.** `seedPlatform(prisma, platformSeedInputFrom({ permissions: platformPermissionCatalog(OPTIONS), settings }, env))`, then `seedVaultSystemSecretTypes(prisma)` (`@marinoscar/vault-api/secret-types`): without the system types there is no Credential type and the agent API has nothing to serve.

## Names the packages own

A host shares one route table, permission registry, settings document, job queue, notification registry, metric registry and audit trail with the packages. `VAULT_RESERVED_NAMES` (`@marinoscar/vault-api/core`) lists what the packages put in each, and `findVaultNameCollisions(hostNames)` reports every host name that falls on one. A package test derives every name from the code, so the list cannot go stale.

| Kind | The packages own | Rule for the host |
|---|---|---|
| Routes (under the global prefix) | `/secrets`, `/secret-types`, `/media`, `/backups/me`, `/admin/backups`, `/agent/v1`, `/agent-activity`, `/mcp` | serve nothing under them |
| Permissions | resources `secrets`, `secret_types`, `media`, `agent_cards`, `agent_identity` | no permission on those resources, nothing starting `vault` |
| Settings namespaces | `vaultCards`, `vaultBackups`, `agentAccess` (reads the platform's `ai`) | none of these, nothing starting `vault` |
| Job types, notification events | `vault.*` | not in `vault.` |
| Email templates | `vault-*` | not in `vault-` |
| OAuth | scopes `vault:*`, resources `agent`, `mcp` | none of these |
| Audit actions | `secret.*`, `secret_type.*`, `secrets.*`, `backups.*`, `agent.credential.*`, `agent.card.*`, `agent.identity.*`, `mcp.*`, `vault.*` | not under these prefixes |
| OpenAPI tags | `Secrets`, `Secret Types`, `Media`, `Backups`, `Agent`, `MCP` | not these |
| Metrics | none (the host names them) | keep the `vault` segment out of the host's own |

The route prefixes, permission ids, `agentAccess` and the audit actions predate the packages and are persisted (tokens, role grants, audit rows), so they are **reserved** rather than renamed; every new name goes into the `vault` namespace.

## Web slices

`@marinoscar/vault-web` has one subpath per slice: `core/headless`, `core/ui`, `secrets/{headless,ui}`, `cards/{headless,ui}`, `media/{headless,ui}`, `backups/{headless,ui}`, `home/{headless,ui}`, `agent/{headless,ui}`, `settings/ui`; plus Vault's own `brand` and `navigation`.

1. **Configure once**, before the first render: `configureVaultWeb({ http, apiBaseUrl, productName })`. `http` is the host's `PlatformHttpClient` (the same instance its `AuthProvider` drives); `productName` is the name the pages' copy shows (default `Vault`).
2. **Mount the pages on the routes they own.** The pages link to absolute paths, so mount each on its Vault path: `/secrets`, `/secrets/new`, `/secrets/:id`, `/secrets/:id/edit`, `/cards`, `/cards/import`, `/cards/:id/renew`, `/media/*`, `/settings/secret-types/*`, `/settings/backups`, `/settings/agent-activity`, `/settings/profile`, `/settings/appearance`, and for the Console pages `/admin/settings/backups`, `/admin/settings/agent-access`, `/admin/settings/ai`, `/admin/settings/general`.
3. **The host supplies** its navigation (its own destinations; gate them with the permission the API enforces: `secrets:read` for secrets and cards, `media:read` for media), its brand (its own shell theme; the pages read only standard MUI palette tokens, never Vault's `/brand`), and the platform providers the pages use: the identity context (`AuthProvider`), `PlatformHostProvider`, `ShellRoot`.
4. **What a page needs from the API besides the Vault routes**: `/api/user-settings` (settings pages, table preferences), `/api/system-settings` (the Console pages; the agent access page edits `agentAccess` there, so mount it only when `VAULT_SETTINGS` reads the platform settings), `/api/ai/config` (card scanning), and the platform storage slice's `/api/storage/objects` (uploading an attachment from the web).

Host Beta mounts secrets, cards, the agent activity page and the profile card under its own app bar, theme colour and name.

## Security responsibilities that move to the host

- **The encryption key and its storage.** The packages never hold a key. The host keeps it in its secret store, out of code and logs, backs it up separately from the database, and owns rotation: a binding that cannot decrypt old rows after a key change has lost every secret. Never re-encrypt or rotate without a rehearsed migration on a restored copy.
- **Backups.** A database backup without the key is unreadable, and the key without the backup is useless: keep both, separately. Every dump and restore carries `--enable-row-security` and `PGOPTIONS=-c app.rls_bypass=on` (the platform's db-backup slice does). The packages' own password-protected archives (`vault.backup.run`) are server-only jobs.
- **Who can read across users.** `secrets:read_any`, `write_any`, `delete_any` and `media:*_any` reach every user's data. They are system-scoped and granted to `admin` by default; grant them to no other role without a reason.
- **The agent kill switches.** `agentAccess.enabled` ships `false`: every `/api/agent/v1` call, and every in-process `AGENT_RELEASE_PORT` call, answers 403 `AGENT_ACCESS_DISABLED` until the host turns it on in whatever `VAULT_SETTINGS` reads. Cards (`agentAccess.cards.enabled`) and identity items (`agentAccess.identity.enabled`) have their own switches, also off by default (403 `CARD_ACCESS_DISABLED`, `IDENTITY_ACCESS_DISABLED`). Agent access is also per item (`agentAccess = fill`, set only by the owner's session), origin-bound, and for a card limited to the merchant grants the owner created.
- **Identity.** The packages trust the platform's `@Auth()` guards and the principal they build; the host's sign-in, sessions, personal access tokens and OAuth server are the host's.

## Calling the agent rules in process

A host whose own agent runs inside the same process (an assistant feature of the host, say) does not need the OAuth hop to `/api/agent/v1`: it injects the release port and calls the same rules directly. `VaultApiModule` binds and exports `AGENT_RELEASE_PORT` (interface `AgentReleasePort`, class `AgentReleaseService`, both from `@marinoscar/vault-api/agent`); the HTTP controllers call the same implementation.

```ts
import { Inject, Injectable } from '@nestjs/common';
import { AGENT_RELEASE_PORT, type AgentReleasePort } from '@marinoscar/vault-api/agent';

@Injectable()
export class HostAssistant {
  constructor(@Inject(AGENT_RELEASE_PORT) private readonly vault: AgentReleasePort) {}

  async signIn(userId: string, origin: string) {
    const as = { userId, clientLabel: 'Host Beta assistant' }; // no `credential`: an embedded call
    const [login] = await this.vault.lookup({ ...as, origin });
    if (!login) return null;
    const { value } = await this.vault.fill({ ...as, secretId: login.id, field: 'password', origin, purpose: 'login' });
    return value; // type it, never log or store it
  }
}
```

| Method | The route it mirrors | Switch |
|---|---|---|
| `lookup`, `fill`, `totp` | `GET /agent/v1/credentials`, `POST /agent/v1/credentials/{id}/fill`, `.../totp` | `agentAccess.enabled` |
| `cardsLookup`, `cardFill`, `cardGrantRequest` | `GET /agent/v1/cards`, `POST /agent/v1/cards/{id}/fill`, `.../grant-requests` | also `agentAccess.cards.enabled` |
| `identityLookup`, `identityFill` | `GET /agent/v1/identity`, `POST /agent/v1/identity/{id}/fill` | also `agentAccess.identity.enabled` |

- **Who is calling.** `userId` is the person the agent acts for; the host has already authenticated them and decides that its agent may act for them. No permission or OAuth scope is checked on this path: the host's own authorization stands in for the route's permission and token scope. Leave `credential` out (passing a request's credential is what the controllers do).
- **`clientLabel`.** The host's (or its app's) display name. The audit row records `credential: 'embedded'` and `clientLabel` (an HTTP call records `oauth` with the client id, or `pat` with the token id); the rate limits count on the bucket `embedded:<label>`; the owner's notifications and the agent activity page name the label as the app. Use one stable label per agent: a new label is a new app (it raises `vault.agent_new_app` on its first fill).
- **The same rules.** The deployment kill switches above, the per-item opt-in, the exact origin binding, the merchant grants with their amount, currency, period and frame rules, one field per call, the rate limits, the audit row and the owner notifications all apply exactly as on the routes. An item that is not opened to agents, or belongs to someone else, is refused exactly as an id that does not exist.
- **Errors** are the Nest `HttpException`s the routes answer with: `404`, `403` with a `code` (`ORIGIN_MISMATCH`, `AGENT_ACCESS_DISABLED`, `CARD_AMOUNT_EXCEEDED`, ...), `429` with `Retry-After`, and `400` when the input fails the route's schema (paths and messages only, never the value).
- **Values.** A fill returns ONE value; the host types it and never logs, returns or persists it.

## The host conformance kit

`runVaultHostConformance(options)` (`@marinoscar/vault-api/testing`) registers one `describe` block that drives the host over HTTP (Fastify `inject` by default): the system secret types are served; a login is created, read back decrypted, updated into a new version and rolled back; a document gets an attachment; a second user cannot read either; the login is opened to agents, looked up through `/api/agent/v1` without a sensitive value and filled for its exact origin only; a browser session is refused on the agent API; and, when given, the audit actions, the host's names (`findVaultNameCollisions`) and the OpenAPI document (unique operation ids, every Vault prefix documented). With `inProcessAgent`, it also resolves `AGENT_RELEASE_PORT` from the app and looks the login up and fills it in process, checks the origin binding (403 `ORIGIN_MISMATCH`) and that an item not opened to agents is refused exactly as an unknown id, and, given `readAuditEvents`, that the fill was audited as `credential: 'embedded'` under the label.

```ts
runVaultHostConformance({
  app: () => app,                        // booted, `app.init()` done
  owner: () => ({ id, session, agentToken }), // a user with secrets:read|write|delete|fill; agentToken is pat_ or oat_
  other: () => ({ session: otherSession }),  // a second user of the same organization
  createStorageObject: (owner) => insertReadyObject(owner.id), // a `ready` storage object the owner uploaded
  readAuditActions: () => readActions(),     // optional
  hostNames: () => ({ routes, permissions, jobTypes, openApiTags, metricNames }), // optional
  openApiDocument: () => SwaggerModule.createDocument(app, config),              // optional
  inProcessAgent: { clientLabel: 'Host assistant', readAuditEvents: () => readRows() }, // optional: the in-process agent check
});
```

Prerequisites: `agentAccess.enabled` is on, the system secret types are seeded. Host Beta's `api/test/api.smoke.spec.ts` is the worked example.

## Not supported when embedded

Kept deliberately, each with its reason (the audit of issue #194):

- **Renaming a route, permission, `agentAccess` or an audit action.** They are persisted in Vault's databases, tokens and clients; they are reserved instead ([Names the packages own](#names-the-packages-own)).
- **A global prefix other than `/api`.** The OAuth protected resources are registered at `/api/agent/v1` and `/api/mcp`.
- **Mounting the API slices under a sub-path** (`/vault/secrets`): Nest's `RouterModule` would move the routes, but the OAuth resources, the web pages and the notification links name the unprefixed paths.
- **Mounting the web pages under a sub-path** (`/vault/*`): the pages and the notification links use absolute paths.
- **OpenAPI operation ids** derive from the controller class names (`SecretsController_create`, `AgentController_lookup`, `McpController_*`, `MediaController_*`): a host controller of the same class name collides. Use another class name or a `operationIdFactory`; the kit's OpenAPI check catches it.
- **Multi-organization tenancy.** The domain reads `storage_objects` in the default organization (`runInDefaultOrg`); in `TENANCY_MODE=multi` it throws `MissingOrgScopeError` instead of choosing one.
- **An audit trail other than `audit_events`.** The agent activity page, the card-expiry reminder dedup and the origins backfill read their rows back through `VAULT_PRISMA`.
- **What stays in Vault's app** and a host re-creates only if it wants the feature: the notification registrations and email templates of the nine `vault.*` events, the settings namespace declarations (schemas and admin pages), the Doctor checks, the `vault-secrets` export source, the onboarding facts, the user-data purge and factory-reset steps, and the metric instrument declarations.
- **Vault's `/brand` and `/navigation`** subpaths are Vault's product, not slices: a host uses its own.
- **The agent rate limiter** counts in process memory; several API instances each count on their own unless the host overrides the `AgentRateLimiter` provider.
- **Reads of a foreign secret** answer 403 on the session routes (404 on the agent API and MCP). Unchanged Vault behaviour; the kit accepts either and checks no content leaks.

## Upgrade procedure

1. Read the packages' changelogs for the range (`CHANGELOG.md` of each), especially port interface changes and new migrations.
2. Bump the four packages together (they are versioned together) and the platform packages to the range they declare as peers.
3. `vault-db sync --names stable` (installs only migrations the lock does not record; never renames one), then `platform db sync` for the platform's, then `platform db compose` and `prisma generate`.
4. `platform db compose --check && platform db check && vault-db check`; commit `prisma/` with both locks.
5. Fix the compile errors in the bindings (a changed port fails the host's build, not a request); bind any new required port.
6. Apply to a restored copy of production first: `prisma migrate deploy` as the ordinary role, `vault-db check --database`, the seed (it converges the system secret types).
7. Run the host conformance kit and the host's own suites, then deploy.

## Links

- [The Vault packages](PACKAGES.md): layout, build, tests, versioning
- [ADR-0001: packages first](decisions/0001-packages-first.md)
- [Authoring a domain migration](runbooks/vault-domain-migration.md)
- [Agent access](decisions/0002-agent-access.md) and [the agent credential API](agent-credential-api.md)
- Package READMEs: [vault-api](../packages/vault-api/README.md), [vault-db](../packages/vault-db/README.md), [vault-web](../packages/vault-web/README.md), [vault-contract](../packages/vault-contract/README.md)
