# @marinoscar/vault-contract

The wire contract of the Vault domain: the Zod schemas of the requests and queries, the response shapes of the backups API, the domain error codes and the system secret-type definitions that the API, the web app and any other host share. Dual CommonJS and ESM, `sideEffects: false`, free of any framework or Node built-in, so it loads in the browser too; the one exception is the test kit `./agent-testing`, which is Node only.

## Purpose and scope

The package holds the shape of the domain's HTTP traffic and nothing that behaves (no service, no controller, no component and no database access), plus one test kit for agent runtimes (`./agent-testing`). The API wraps the schemas in `createZodDto` classes, the web types its requests with them, and a second host gets the same contract by installing one package. It does not hold the platform's shapes (they come from `@marinoscar/platform-contract`), the scheduling math of `computeNextRunAt`, or anything server-only.

Status: experimental, except the agent contract (`./agent` and `./agent-testing`), which is **beta** since issue 196 (see "Stability of the agent contract" below). Introduced in E12.1 (issue 102) by moving the schemas out of the API's `dto/` files with no change to a field name, a limit or a message; the API's DTO files re-export them under their old names.

Entry points (every schema and constant is in a slice; the root exports only `VAULT_CONTRACT_PACKAGE`):

- `@marinoscar/vault-contract/secrets`: create, update, list, renew, attachment and card-summary bodies and queries, `attachmentRoleSchema`, the document image slots (`DOCUMENT_IMAGE_SLOTS`, `imageSlotsFor`, `ID1_ASPECT_RATIO`, `ID3_ASPECT_RATIO`), the attachment response.
- `@marinoscar/vault-contract/secret-types`: field definitions, create/update/query bodies, `CARD_NETWORKS`, `CARD_KINDS`, `SYSTEM_SECRET_TYPES` (the built-in types, append-only).
- `@marinoscar/vault-contract/backups`: content-selection rules (`BACKUP_CONTENT_*`, `contentSelectionIssues`, `resolveContentSelection`), the schedule vocabulary and validators, the user export, system export and schedule schemas, the run list query, and the backups API response types.
- `@marinoscar/vault-contract/media`: folder and file bodies and queries.
- `@marinoscar/vault-contract/agent`: the provider contract of the agent credential API (`/api/agent/v1`, **beta**; contract version `AGENT_CONTRACT_VERSION`, 1.2): lookup, fill, totp, create and rotate request and response schemas, `agentPurposeSchema`, the generated-password options, `AGENT_ERROR_CODES` (`ORIGIN_MISMATCH`, `AGENT_ACCESS_DISABLED`, `AGENT_CREDENTIAL_REQUIRED`, `RATE_LIMITED`), `AGENT_AUDIT_ACTIONS`, `AGENT_SCOPES` and the `agentAccess` settings schema and defaults. Since ADR-0003 also cards and identity: `agentCardFillRequestSchema`, `agentCardSummarySchema`, `agentCardGrantRequestCreateSchema`, `agentIdentityFillRequestSchema`, `agentIdentitySummarySchema`, `AGENT_IDENTITY_FIELDS`, `AGENT_CARD_FIELD_MAP`, the amount and currency schemas and helpers (`amountToMinor`, `minorToAmount`, `formatMinorAmount`), the owner's `createCardGrantSchema`, `cardGrantSchema`, `cardGrantRequestSchema` and `CARD_GRANT_AUDIT_ACTIONS`, the `cards` and `identity` settings blocks (both off) with `resolveAgentAccessSettings`, the scopes `vault:cards_*` and `vault:identity_*` and the card error codes (`CARD_ACCESS_DISABLED`, `IDENTITY_ACCESS_DISABLED`, `SECURITY_CODE_NOT_GRANTED`, `CARD_AMOUNT_EXCEEDED`, `CARD_CURRENCY_MISMATCH`, `CARD_PERIOD_LIMIT_REACHED`, `CARD_DAILY_CAP_REACHED`, `CARD_GRANT_EXPIRED`, `CARD_GRANT_EXISTS`, `CARD_GRANT_REQUEST_NOT_PENDING`, `OWNER_SESSION_REQUIRED`). `@marinoscar/vault-contract/secret-types` adds the `Identity` system type and the Card's `billing_postal_code`. Since contract 1.2: `AGENT_CONTRACT_VERSION`, `AGENT_CONTRACT_FEATURES`, `agentContractInfoSchema`, `agentContractInfoFor` and the optional `contract` block of `agentWhoamiResponseSchema`.
- `@marinoscar/vault-contract/agent-testing`: the conformance kit for an agent runtime's tests (Node only, beta): `createFakeVault` (an in-memory `/api/agent/v1` built from the schemas above, seeded with invented data, refusing to start with `NODE_ENV=production`; not a secrets store), the canary helpers `seedCanaries`, `createCanary`, `findCanaries` and `assertNoCanary`, the scenario list `AGENT_CONFORMANCE_SCENARIOS` with the runner `runAgentConformance` / `assertAgentConformance` (plain functions, no test framework), `createConformanceSeed` and `createReferenceSignIn`. What passing proves and does not prove: [the guide, section 10](../../docs/agent-credential-api.md#10-conformance-kit).
- `@marinoscar/vault-contract/errors`: `VAULT_ERROR_CODES` (code, status, description), `AI_ERROR_CODES`, `isVaultErrorCode`.
- `@marinoscar/vault-contract/common`: `typeErrors`, the Zod 4 replacement for `required_error` / `invalid_type_error`.

## Install and peer dependencies

```bash
npm install @marinoscar/vault-contract@next zod@^4.4.3
```

Published to npm under the `next` dist-tag until 1.0, with a provenance attestation; the install, the dist-tag policy and the current publication status are in [docs/PACKAGES.md](../../docs/PACKAGES.md#installing-from-npm). The package works from CommonJS (`require`) and ESM (`import`), and its types resolve under `moduleResolution` `node16`, `nodenext` and `bundler`.

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

## Stability of the agent contract

`./agent` is tagged `@stability beta` (issue 196); it becomes `stable` at 1.0. The promise, in full in [the guide, section 9](../../docs/agent-credential-api.md#9-stability):

- **Does not change inside `/api/agent/v1`:** route paths, required request fields, the meaning of each code in `AGENT_ERROR_CODES`, the scope names in `AGENT_SCOPES`, and the rule that a response carries at most one secret field.
- **May change without a new version:** new optional request fields, new response fields and response enum values, new error codes and scopes for new routes, new `whoami` feature ids, stricter rate-limit defaults. A runtime ignores what it does not know and never branches on `message`.
- **Anything else is `/api/agent/v2`.** `v1` keeps working for two minor releases of the packages after the release that ships `v2`.

`test/agent-contract-snapshot.test.ts` holds it: a committed snapshot of every public schema of `./agent` (field names, requiredness, enums) and of `AGENT_SCOPES` and `AGENT_ERROR_CODES`; an additive difference passes, a breaking one fails until the path version, `AGENT_CONTRACT_VERSION`, an `ACCEPT_BREAKING` entry in [the changelog](../../docs/agent-credential-api.md#8-changes) and the snapshot all say so. Refresh the snapshot with `UPDATE_AGENT_CONTRACT_SNAPSHOT=1 npx vitest run test/agent-contract-snapshot.test.ts`.

## Security notes

Schemas validate shape and size only. Every message is static text and never echoes a submitted value; the export and schedule schemas are written so a validation error can be logged without leaking a backup password. No schema or constant holds a secret. `./agent-testing` holds only invented data (`Person A`, `*.example.test`, the published test card number `4242424242424242`, random canaries), keeps it in memory, binds to `127.0.0.1` and refuses to run with `NODE_ENV=production`; its errors and reports name where a canary was found, never the value.

## Links

- [The Vault packages](../../docs/PACKAGES.md)
- [ADR-0001: packages first](../../docs/decisions/0001-packages-first.md)
- [Agent credential API guide (stability, changes, conformance kit)](../../docs/agent-credential-api.md)
