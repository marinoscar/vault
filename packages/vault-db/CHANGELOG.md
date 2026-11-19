# @marinoscar/vault-db

## 0.1.0-next.3

### Patch Changes

- d16fe7b: The package READMEs say how to install from npm (the `next` dist-tag, the peers, provenance) for the first published release (#192). No code change.

## 0.1.0-next.2

### Minor Changes

- 60b975f: Add `secrets.agent_access` (enum `secret_agent_access`: `none` | `fill`, default `none`) and `secrets.agent_access_changed_at`.
- 9a5a86d: vault-db: `secrets.origins text[] NOT NULL DEFAULT '{}'` (website origins: scheme, host and port only, plaintext metadata) with the GIN index `secrets_origins_gin_idx` for `@>` and `&&` lookups (migration `add_secret_origins`).

## 0.1.0-next.1

## 0.1.0-next.0

- Initial version (E12.1, issue 102). Moved out of `apps/api` and `apps/web` without changing behaviour or a field; see the README.
