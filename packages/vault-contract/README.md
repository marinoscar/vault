# @marinoscar/vault-contract

The wire contract of the Vault domain: the Zod schemas of the requests and queries, the response shapes of the backups API, the domain error codes and the system secret-type definitions that the API, the web app and any other host share. Dual CommonJS and ESM, `sideEffects: false`, free of any framework or Node built-in, so it loads in the browser too.

## Purpose and scope

The package holds the shape of the domain's HTTP traffic and nothing that behaves: no service, no controller, no component and no database access. The API wraps the schemas in `createZodDto` classes, the web types its requests with them, and a second host gets the same contract by installing one package. It does not hold the platform's shapes (they come from `@marinoscar/platform-contract`), the scheduling math of `computeNextRunAt`, or anything server-only.

Status: experimental. Introduced in E12.1 (issue 102) by moving the schemas out of the API's `dto/` files with no change to a field name, a limit or a message; the API's DTO files re-export them under their old names.

Entry points (every schema and constant is in a slice; the root exports only `VAULT_CONTRACT_PACKAGE`):

- `@marinoscar/vault-contract/secrets`: create, update, list, renew, attachment and card-summary bodies and queries, `attachmentRoleSchema`, the attachment response.
- `@marinoscar/vault-contract/secret-types`: field definitions, create/update/query bodies, `CARD_NETWORKS`, `CARD_KINDS`, `SYSTEM_SECRET_TYPES` (the built-in types, append-only).
- `@marinoscar/vault-contract/backups`: content-selection rules (`BACKUP_CONTENT_*`, `contentSelectionIssues`, `resolveContentSelection`), the schedule vocabulary and validators, the user export, system export and schedule schemas, the run list query, and the backups API response types.
- `@marinoscar/vault-contract/media`: folder and file bodies and queries.
- `@marinoscar/vault-contract/errors`: `VAULT_ERROR_CODES` (code, status, description), `AI_ERROR_CODES`, `isVaultErrorCode`.
- `@marinoscar/vault-contract/common`: `typeErrors`, the Zod 4 replacement for `required_error` / `invalid_type_error`.

## Install and peer dependencies

```bash
npm install @marinoscar/vault-contract@next
```

The package never bundles Zod, because a second copy breaks `instanceof ZodError` checks:

| Package | Range | Needed by |
|---|---|---|
| `zod` | `^4.4.3` | every slice (required) |

## Quick start

```ts
import { createSecretSchema } from '@marinoscar/vault-contract/secrets';
import { VAULT_ERROR_CODES } from '@marinoscar/vault-contract/errors';
// CommonJS: const { createSecretSchema } = require('@marinoscar/vault-contract/secrets');

const body = createSecretSchema.parse(input);
```

In the API, import the DTO class from the module's `dto/` file as before; the schema behind it is the one above. The error codes are data: `app-registrations/error-codes.ts` registers them with the platform. Keep the `.js` extension on every relative import inside the package; the ESM build fails at run time without it.

## Configuration

None. The package reads no environment variable and takes no option.

## Extension-point catalog

None. A new code, schema or constant is added here, in the slice that owns it, with a test; a host never extends the package at run time.

## Build and test

```bash
npm run build -w @marinoscar/vault-contract      # dist/cjs and dist/esm, with a package.json stub in each
npm run test:run -w @marinoscar/vault-contract   # Vitest
npm run typecheck -w @marinoscar/vault-contract
```

The apps import the built output, so build the packages after `npm ci` and before the app's typecheck or tests (`npm run build:packages` at the root).

## Security notes

Schemas validate shape and size only. Every message is static text and never echoes a submitted value; the export and schedule schemas are written so a validation error can be logged without leaking a backup password. No schema or constant holds a secret.

## Links

- [The Vault packages](../../docs/PACKAGES.md)
- [ADR-0001: packages first](../../docs/decisions/0001-packages-first.md)
