---
'@marinoscar/vault-contract': minor
'@marinoscar/vault-api': minor
---

The agent contract is beta, with a versioning promise and a conformance kit for agent runtimes (#196).

- `@marinoscar/vault-contract`: `./agent` is `@stability beta`. `AGENT_CONTRACT_VERSION` (`1.2`), `AGENT_CONTRACT_FEATURES`, `agentContractInfoSchema`, `agentContractInfoFor`, and an optional `contract` block on `agentWhoamiResponseSchema`. New subpath `./agent-testing` (Node only, CommonJS and ESM): `createFakeVault` (an in-memory `/api/agent/v1` with exact origin binding, the identical 404, scopes, kill switches, rate limits with `Retry-After`, refresh-token rotation and replay revocation; invented data only; refuses `NODE_ENV=production`), the canary helpers `seedCanaries`, `createCanary`, `findCanaries`, `assertNoCanary`, the scenario list `AGENT_CONFORMANCE_SCENARIOS` with `runAgentConformance` / `assertAgentConformance`, `createConformanceSeed` and `createReferenceSignIn`. A shape snapshot test holds the promise: additive changes pass, breaking ones need `/api/agent/v2` and an `ACCEPT_BREAKING` changelog entry. `v1` stays for two minor releases after `v2` ships.
- `@marinoscar/vault-api`: `GET /api/agent/v1/whoami` adds `contract: { version, features }` (`logins`, `totp`, and `cards` / `identity` while their switches are on); `AgentCredentialsService.contractInfo()`. Additive.
