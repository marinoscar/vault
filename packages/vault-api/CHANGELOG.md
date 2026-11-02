# @marinoscar/vault-api

## 0.1.0-next.2

### Minor Changes

- 2318f0a: Remove the `GET /api/ai/status` compatibility route (`AiStatusController`); clients read the platform's `GET /api/ai/config`.

## 0.1.0-next.1

### Minor Changes

- 8edda96: New package: the Vault API domain (secrets, secret types, attachments, the export zip, backups, media, card extraction and the card-expiry reminders) as NestJS slices behind twelve ports, mounted with `VaultApiModule.forRoot({ bindings, imports })`; fakes for every port under `@marinoscar/vault-api/testing`.

## 0.1.0-next.0

- Initial version (E12.2, issue 103). The API side of the Vault domain moved out of `apps/api/src` without changing a route, a permission, a job type, a notification key, an audit action or a metric name; see the README.
