# Host Beta: the second-host fixture

The smallest EnterpriseAppBase-style host that is **not** Vault, mounting the Vault packages. It is a test fixture, not a product (issue #194): it proves the packages bind with another host's identity, roles, schema, migrations and bindings, and it exercises every step of [docs/EMBEDDING.md](../../docs/EMBEDDING.md).

- `packages/shared/identity.json`: its own product name (`Host Beta`) and slug (`hostbeta`).
- `api/`: the NestJS host. `src/permissions.ts` (its roles `beta_editor` / `beta_reader`, its permissions, Vault's grants mapped onto its roles), `src/registrations.ts`, `src/vault-bindings.ts` (a binding for every Vault port; its cipher key is `HOST_BETA_DATA_KEYS`, not `VAULT_ENCRYPTION_KEY`), `src/app.module.ts`, `src/beta-notes.controller.ts` (its one page, on its own table `beta_notes`). `prisma/` is its committed migration history: the platform's, the `vault-db sync --names stable` copies, then its own; `prisma/schema/` is composed. Its Prisma client is generated into `api/generated/client` (git-ignored), never into `node_modules`.
- `api/test/api.smoke.spec.ts`: builds a real database as an ordinary role, migrates, runs `vault-db check --database`, seeds, boots the host and runs `runVaultHostConformance` (`@marinoscar/vault-api/testing`) (with its `inProcessAgent` check) plus its own checks, among them the agent rules called in process through `AGENT_RELEASE_PORT` for a login, a card under a merchant grant and an identity item, audited as `credential: 'embedded'` with the label `Host Beta assistant`.
- `web/`: its own theme, navigation and product name around the `vault-web` secrets, cards, agent and settings slices; `web/test/web.smoke.test.tsx` renders them over MSW.

It is not an npm workspace: it resolves everything from the repository root's `node_modules`, so root `npm ci` is unchanged, and it imports the **built** packages, like an installed host. A real host would `npm install @marinoscar/vault-api@next @marinoscar/vault-web@next @marinoscar/vault-contract@next` and `npm install -D @marinoscar/vault-db@next`.

## Run it

```bash
npm ci && npm run build:packages                 # from the repository root
cd tests/second-host
npm run db:check                                 # composed schema, platform.lock, vault.lock
npm run prisma:generate                          # the host's own client
npm run typecheck
SECOND_HOST_ADMIN_URL=postgresql://postgres:postgres@localhost:5432/postgres npm run test:api
npm run test:web
```

`SECOND_HOST_ADMIN_URL` is a PostgreSQL 16 superuser connection; the suite creates a role and a database named `vault_i194_*` and drops both at the end. CI runs all of the above in the `second-host` job of `.github/workflows/ci.yml`.

After a platform or `vault-db` upgrade, `npm run db:sync` reinstalls the history (it only appends) and recomposes the schema; commit `api/prisma/`.
