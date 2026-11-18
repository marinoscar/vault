# ADR-0002: Agent access: runtimes get one field over REST, chat assistants never get a value over MCP

- Status: Accepted
- Date: 2026-11-18
- Related issues: epic #172 (E14); #174 to #181; marinoscar/EnterpriseAppBase#1201, #1202, #1212

## Context

Until E14 the only machine credential was a personal access token (`pat_`), which carries the user's full authority, has no scopes, and reaches every route. There was no OAuth server, no lookup of a login by website, no one-time code and no MCP endpoint. Two new kinds of caller now need Vault:

1. **Computer-use agent runtimes** (for example "Agent runtime X", a browser-automation fabric). They log in to websites for a person. They need the real password, but only to type it into a page.
2. **Chat assistants and coding agents** (Claude, ChatGPT, Claude Code, MCP Inspector) over the Model Context Protocol. They help a person find and save secrets.

Both change the threat model: a secret can now leave Vault for a third-party process, and the party driving that process is a language model that reads untrusted web pages and documents. A tool result that reaches a model leaves Vault's control for good (provider logs, conversation history, a later tool call). The question is how to serve these callers without making Vault a way to exfiltrate its own contents.

## Decision

1. **Runtimes use a typed REST API, never MCP, for secret values.** `/api/agent/v1` returns a value to the runtime process, which types it into the page and never shows it to a model ([provider guide](../agent-credential-api.md)). MCP tool results go into the model's context, so MCP carries no value.
2. **Access is opt-in per secret.** `secrets.agent_access` is `none` or `fill`, default `none` for every secret including all that existed before. Only a system `Credential` can be `fill`. Only the owner, with a session credential, can change it; an `oat_` token is refused on that route, so an agent cannot widen its own access. A closed, foreign or missing secret is one identical `404`.
3. **Exact-origin binding.** A fill, code or rotate call names the origin the agent is on, and Vault refuses (`403 ORIGIN_MISMATCH`) unless it equals one of the credential's stored origins after normalization (scheme, host, port). A same-site subdomain is shown by lookup (`matchKind: site`) but never fillable. This is the control against a prompt-injected agent steered to a look-alike site.
4. **One field per call.** `fill` returns `username` or `password` in a response of its own; `totp` returns the current code, never the seed. No route returns a record or a decrypted version.
5. **Scoped `oat_` tokens with route confinement.** Access goes through the platform OAuth 2.1 server (authorization code with PKCE, consent, refresh rotation with reuse detection, revocation). Scopes narrow the user's permissions (`vault:items_read`, `vault:items_fill`, `vault:items_write` for the `agent` resource; `vault:mcp_read`, `vault:mcp_write` for the `mcp` resource). An `oat_` token is accepted only under its resource's prefix: `/api/agent/v1` or `/api/mcp`, never `/api/secrets/*` or any other route, and not the other resource.
6. **No plaintext over MCP.** Every MCP result is built from an allow-list of non-sensitive fields; sensitive fields are `"[hidden]"` or absent; a fail-closed redaction guard withholds any result containing a value the tool decrypted, generated or received. A generated password is stored and never returned. A `reveal_secret` tool is out of scope and would need its own decision.
7. **MCP cannot change a website.** `update_secret` refuses `url` and `additional_urls`. Origins are what binds a later agent fill; if a model could change them it could redirect a credential the owner opened to agents.
8. **Kill switch, off by default.** The deployment setting `agentAccess.enabled` (default `false`, `system_settings:write`) answers `403 AGENT_ACCESS_DISABLED` on every agent route and every MCP `tools/call`. The OAuth server has its own switch; both must be on.
9. **Rate limits.** Per OAuth grant (or PAT) and user, counted before the secret is looked up: lookup 60, fill 30, totp 10, write 10 per minute (settings), MCP `tools/call` 60 per minute (constant). `429 RATE_LIMITED` with `Retry-After`.
10. **Audit every call.** One `audit_events` row per agent call and per MCP tool call, allowed or refused, naming client, credential kind, secret, origin and purpose, never a value, code or password. A successful call is audited before its response is returned: an unwritable trail fails the call. The owner reads it at Agent activity and is notified (email and bell) of a created login, a rotation and the first use by a new app.
11. **MCP is a local stop-gap.** The platform has no MCP slice. The protocol layer lives in `packages/vault-api/src/mcp/` and is recorded in [local-exceptions](../platform-adoption/local-exceptions.md) until marinoscar/EnterpriseAppBase#1201 ships; then it is deleted and the five tools are registered with the platform registry.

## Consequences

- **Origins are plaintext metadata.** Lookup by website must not decrypt every secret, so `secrets.origins` (`scheme://host[:port]` only, GIN-indexed) is stored in the clear, like the secret's name. A database reader learns which sites a user has logins for, never a path, a username or a value.
- **Agent access is a second gate**, so an owner must open each login once. That is friction by design: a token with `vault:items_fill` still reaches only what the owner opened.
- **`update_secret` cannot fix a wrong URL.** The owner edits it in Vault. A model-created login (`create_secret`) with `allowAgents: false` stays invisible to MCP until the owner opens it.
- **Generated passwords through MCP are invisible to the assistant.** The owner reads them in Vault. A runtime that creates a login over the agent API receives the generated password once, in the create or rotate response.
- **Cards and CVV are out of scope** for both surfaces: only `Credential` secrets can be opened to agents.
- **Rate limits are in process memory** (`AgentRateLimiter`), correct for one API instance. A second instance needs a shared provider.
- **Prompt injection is reduced, not removed.** An agent holding a fill scope can still be tricked into filling a login for a site that really is one of the credential's origins. The controls bound the damage (one field, exact origin, per-secret opt-in, rate limit, audit, owner notification, revocation).
- **Platform gaps that cost us work or accuracy.** #1201 (no MCP slice) is why a protocol layer sits in the package. #1212 (the OAuth conformance token-confinement check cannot pass with two protected resources) is why `apps/api/test/conformance.spec.ts` runs the `oauth-server` suite once per resource, with the full checks each time. #1202 (`platform db baseline` never reports "nothing to do" once `platform.lock` has `appMigrations`) is a known annoyance for the baseline runbook, not a security matter.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Serve secret values through MCP | The tool result enters model context, logs and history; a prompt-injected model could also echo it into another tool call. A runtime that must type a value has a better path (REST). |
| A `reveal_secret` MCP tool with per-call approval | Needs its own scope, elicitation-based approval, a short-lived audit flag and no card support. A separate decision and issue. |
| Reuse personal access tokens for agents | Full authority, no scopes, no consent screen, no per-app revocation, no route confinement. |
| Access to every secret the user can read, scopes only | One over-broad token would expose the whole vault. Per-secret opt-in makes the owner's choice, not the token's, the boundary. |
| Origin check by registrable domain (site match) | A compromised or user-content subdomain would receive the credential. Exact origin only. |
| Return the whole credential and let the runtime pick | The runtime (and its model, if it logs) holds fields it did not need. One field per call. |
| Hash or encrypt origins | Lookup by website would need a per-secret decrypt or a blind index; the plaintext trade-off was accepted for a host-only value. |
| Write the MCP protocol into `apps/api` | `no-domain-logic.spec.ts` forbids controllers there; a second protocol implementation in an app drifts. It sits in the package, flagged as a stop-gap. |

## Enforcement

- `apps/api/test/agent/agent-api.db.spec.ts` and `apps/api/test/mcp/mcp.db.spec.ts` drive a real OAuth flow and scan every response, audit row, log line and console line for a canary password and other planted values.
- The package tests in `packages/vault-api/src/agent/` and `packages/vault-api/src/mcp/` cover origin binding, one field per call, the redaction guard, the tool registry (a tool without title, scope, permission and effect does not register) and the canary over every tool and argument shape.
- `apps/api/test/conformance.spec.ts` runs the platform `oauth-server` suite (route confinement, step-up, egress) for each protected resource.
- The `agentAccess` kill switch is exercised on every route and tool; its default (`false`) is the settings schema default.
- Review item for any pull request that touches `packages/vault-api/src/agent/` or `mcp/`: no route returns more than one sensitive field, no MCP result carries a sensitive value, no `oat_` token reaches a route outside its resource.

## Related issues

Epic #172; #174 (OAuth server), #175 (opt-in), #176 (origins), #177 (TOTP), #178 (agent API), #179 (activity and notifications), #180 (MCP), #181 (this record). Upstream: marinoscar/EnterpriseAppBase#1201, #1202, #1212.
