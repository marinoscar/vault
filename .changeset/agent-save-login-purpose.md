---
'@marinoscar/vault-contract': minor
'@marinoscar/vault-api': minor
---

Agent API: a purpose for saving a login the owner already signed in with (#233), agent contract 1.3 (additive, stability beta).

- `@marinoscar/vault-contract`: `agentPurposeSchema` gains the value `save_login`, appended last (`login`, `signup`, `password_change`, `mfa`, `save_login`). It means "saving a login the owner already uses; send it with `POST /credentials`", is accepted wherever a purpose is, and is stored in the audit row like any purpose. `AGENT_CONTRACT_VERSION` moves from `1.2` to `1.3` and `AGENT_CONTRACT_FEATURES` gains `SAVE_LOGIN: 'save_login'`; the agent contract snapshot is refreshed (additive: a new enum value in a request, a new feature id). The conformance kit's fake Vault reports the feature in `whoami`.
- `@marinoscar/vault-api`: `whoami.contract.features` always lists `save_login` (after `logins` and `totp`, before `cards` and `identity`). The create route is unchanged: the credential it creates is opened to agents for every purpose, a name already in use still answers 409, and the purpose `save_login` is recorded in the audit row.
