# ADR-0006: Credential broker: an agent uses a key stored in Vault without ever seeing it

- Status: Accepted
- Date: 2026-11-28
- Related issues: #246; builds on [ADR-0002](0002-agent-access.md) and [ADR-0005](0005-assistant-reveal.md)

## Context

An agent (a coding assistant in a cloud sandbox, a script, an SDK) often needs to USE a key, not to know it: call an API with an `Authorization` header, then discard the result. The options before this decision were all worse than the need:

- **Reveal** ([ADR-0005](0005-assistant-reveal.md)) hands the value to the assistant. A revealed value enters the model's context and cannot be recalled (provider logs, conversation history, a later tool call).
- **Copying the key into each sandbox** (an environment variable, a network secret per key) duplicates the key into every environment that holds it. Rotating the key in Vault then does not rotate the copies, and every copy is another place to leak from.
- **A personal access token** gives the agent the owner's full authority, with no per-secret choice.

What is needed is the reverse of reveal: the agent calls Vault, Vault adds the key server-side and forwards the request to an upstream host the owner allowed, and the key never leaves the server. The cost is that Vault becomes an outbound HTTP client acting on behalf of a caller, which is a server-side request forgery (SSRF) surface that must be closed by design.

## Decision

1. **A broker token, `vbk_`.** `vbk_` plus 40 random base62 characters, created by the owner, shown once and stored only as a SHA-256 hash (`broker_tokens`, with a display prefix of the first 12 characters). It is accepted only on `/api/broker/v1/*`; every other credential route refuses it. It can use keys and can never read them. Optional restriction to specific secret ids (empty means every broker-enabled secret of the owner), optional expiry, revocable, `last_used_at` stamped on use. A user saves one `vbk_` token as the proxy-injected network secret for the Vault host in a Claude cloud environment, so the sandbox never holds a key.
2. **Who may call the broker.** A `vbk_` token or a personal access token (`pat_`, which already carries the owner's full authority, for the CLI and scripts). `oat_` tokens and browser sessions are refused in v1; an OAuth resource for the broker is a deferred follow-up. Broker-token management (`POST/GET /api/broker/tokens`, `POST /api/broker/tokens/:id/revoke`, `DELETE`) accepts a session or a PAT only: `oat_` and `vbk_` are refused, so a token cannot mint or revoke tokens. Audited `broker.token.create` and `broker.token.revoke`; the list never returns the token or its hash.
3. **Per-secret owner opt-in, default off.** `PATCH /api/secrets/:id/broker-access { enabled, origins?, injection?, field? }` needs `secrets:write` and ownership (looked up by creator; `secrets:write_any` does not help), session or PAT; `oat_` and `vbk_` are refused. The state lives on the secret: `broker_access` (default `false`), `broker_origins` (1 to 20 exact HTTPS origins), `broker_injection`, `broker_field`, `broker_access_changed_at`. Supported types are the system `API Key`, `Token` and `Service Key`, and custom types with exactly one sensitive field (or a `field` that names a sensitive one); anything else answers `422 BROKER_UNSUPPORTED_TYPE`. Turning the switch off is always allowed. Enabling needs at least one origin (`422 BROKER_ORIGINS_REQUIRED`). Audited `secret.broker_access.update` with from/to, origins and the injection kind and name, never a value.
4. **Origins are exact and validated.** An origin is `https://host[:port]`, lowercase host, no userinfo, no path or query. A host that is an IP literal in a private, loopback, link-local or metadata range, `localhost`, `*.local` or `*.internal` answers `422 BROKER_ORIGIN_INVALID`. There are no wildcards and no prefix matches.
5. **Injection shapes are a closed set.** `{ kind: 'header', name, prefix? }` with `name` matching `^[A-Za-z0-9-]{1,64}$` and `prefix` one of empty, `Bearer`, `Token`, `Basic`, `Bot`, `ApiKey`; or `{ kind: 'query', name }` with `name` matching `^[A-Za-z0-9_.-]{1,64}$`. A header named `host`, `cookie`, `set-cookie`, `content-length`, `transfer-encoding`, `connection`, `upgrade`, `proxy-*`, `forwarded`, `x-forwarded-*`, `x-real-ip` or `x-vault-*` is refused. An unset injection means `Authorization: Bearer`.
6. **The endpoint is path-form.** `ALL /api/broker/v1/:secretId/:upstreamHost/*` forwards to `https://{upstreamHost}/{rest}?{query}`; `upstreamHost` may carry `:port`. The origin `https://{upstreamHost}` must equal one of the secret's `broker_origins` exactly. The form lets an SDK need only a base URL: `https://vault.example.test/api/broker/v1/<secretId>/api.service-x.example`. The raw upstream response is returned, not wrapped in the `{ data }` envelope (as the export zip is not).
7. **Checks run in a fixed order, fail closed, before any decryption:** credential kind (`vbk_` or `pat_`); `agentAccess.enabled` and `agentAccess.broker.enabled` (`403 BROKER_DISABLED`); rate limit `agentAccess.broker.forwardsPerMinute` per token and user (`429 RATE_LIMITED` with `Retry-After`); token restricted to this secret; secret owned by the caller, `broker_access` true and a supported type (otherwise one identical `404`, no oracle); origin match (`403 BROKER_ORIGIN_MISMATCH`); only then decrypt the one field of the current version.
8. **SSRF controls, all required.**
   - HTTPS only; the port comes from the origin (default 443). TLS certificate and host name verification are never disabled; `servername` is the host.
   - DNS is resolved once (`dns.lookup(host, { all: true })`). If ANY returned address is private, loopback, link-local, CGNAT, multicast, unspecified or metadata, the call is refused (`403 BROKER_DESTINATION_BLOCKED`). IPv4: `0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`, `192.168/16`, `198.18/15`, `224/4`, `240/4`, `255.255.255.255`. IPv6: `::/128`, `::1`, `fc00::/7`, `fe80::/10`, `ff00::/8`, and IPv4-mapped (`::ffff:`) and `64:ff9b::/96` forms of any blocked IPv4 address.
   - The connection is pinned to the validated address with a custom `lookup`, so a second resolution (DNS rebinding) cannot change the destination.
   - Redirects are never followed; a `3xx` is returned as is, with `Location` passed through.
   - Request headers are stripped of `Authorization`, `Cookie`, `Host`, `Proxy-*`, `Forwarded`, `X-Forwarded-*`, `X-Real-IP`, `X-Vault-*`, the hop-by-hop headers (`Connection`, `Keep-Alive`, `TE`, `Trailer`, `Transfer-Encoding`, `Upgrade`) and `Content-Length` (recomputed); the injection is set last, so a caller cannot choose or override it.
   - Caps, from settings: `maxRequestBytes` (default 10 MiB, `413 BROKER_REQUEST_TOO_LARGE`), `maxResponseBytes` (default 25 MiB, `502 BROKER_RESPONSE_TOO_LARGE`), `timeoutMs` (default 30000, `504 BROKER_UPSTREAM_TIMEOUT`). A connection failure answers `502 BROKER_UPSTREAM_ERROR` with no internal detail and no address.
9. **No echo, fail closed.** The response is buffered up to `maxResponseBytes` and scanned. If the key, its base64 form or its percent-encoded form (for `Basic`, the encoded credential too) appears in the body or any header, the response is withheld (`502 BROKER_KEY_ECHO`) and the event audited. Otherwise the status, the filtered headers (`Set-Cookie`, hop-by-hop headers and any header whose value holds the key are dropped) and the body are returned with `X-Vault-Broker: 1`.
10. **Settings, off by default.** `agentAccess.broker = { enabled: false, forwardsPerMinute: 60, maxRequestBytes, maxResponseBytes, timeoutMs }` is an additive, optional part of the agent-access settings, edited on `/admin/settings/agent-access`. Two switches must be on to forward: the existing `agentAccess.enabled` kill switch and `agentAccess.broker.enabled`.
11. **Audit and visibility.** Every call, allowed or refused, writes `broker.forward`: secret id, token id and kind (never the token), upstream origin, method, path without the query string, status, request and response byte counts, duration and outcome. Never the key, the body, the query or any header. Agent activity shows the action `broker_forward`, "Used through the broker", with origin, method and status. The owner sees the opt-in in the web app (a switch with a confirmation, the allowed origins, the injection shape, a "Broker" chip in the list) and manages tokens in a "Broker tokens" settings card.
12. **Not a queue job.** A forward completes within the HTTP request and its `timeoutMs`; it is not long-running work in the sense of the queue rule.
13. **Everything else from ADR-0002 and ADR-0005 holds.** The agent REST API still returns at most one sensitive field per call, an `oat_` token never reaches `/api/secrets/*`, and the broker returns no key through any route, only the upstream's response.

## Consequences

- **Vault becomes an egress point.** Operators must accept outbound HTTPS traffic from the API host to every origin an owner allows, and may need to allow it in network policy. The feature is off until an administrator switches it on.
- **Responses pass through Vault and are buffered** up to `maxResponseBytes` so they can be scanned. This costs memory and latency, and large or streaming responses are not supported.
- **A stolen `vbk_` token can spend keys against their allowed origins until revoked.** The damage is bounded by the origin allowlist, the per-minute rate limit, the optional secret restriction and expiry, revocation, and an audit row per call. It cannot read a key and cannot reach any other route.
- **The agent still sees the API responses.** Data the upstream returns enters the agent's context. The broker protects the key, not the data behind it.
- **Prompt injection can make an agent call an allowed API with the owner's key.** A model steered by a hostile page can send any request the key permits to an allowed origin. The controls bound this and do not remove it. Owners should allow narrow origins and opt in scoped, cheap-to-rotate keys.
- **Rotation works.** The key lives in one place; updating the secret in Vault changes what the next forward injects, and no sandbox holds a copy.
- **Echo detection is best effort for transformed keys.** A response that encodes the key in a form not listed (for example a hash or a split value) is not caught. The origin allowlist is what limits who could echo it.
- **A contract and schema addition.** `agentAccess.broker`, the `brokerAccess*` secret fields, the `broker_forward` activity action and the `broker_tokens` table are additive. The new columns and table are domain schema through `vault-db promote` ([runbook](../runbooks/vault-domain-migration.md)).
- **Rate limits are in process memory**, as in ADR-0002.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Reveal the key to the agent ([ADR-0005](0005-assistant-reveal.md)) | The value enters the model's context and cannot be recalled; the broker is for the case where the agent only needs to use the key |
| A network secret per key in the sandbox environment | Duplicates each key into every environment, needs an environment change and an administrator per key, and breaks rotation |
| An MCP `call_api` tool | Ties the broker to chat assistants, puts request and response bodies through the model's tool channel and cannot serve an SDK or a script by base URL |
| An OAuth resource for the broker (`oat_`) | Fits the model, but needs scope, consent and resource work; deferred as a follow-up. `vbk_` and `pat_` cover v1 |
| A generic forward proxy (`CONNECT`) | Tunnelled TLS cannot be inspected, so key injection, the no-echo scan, header stripping and per-origin audit are impossible, and it is an open relay if misconfigured. Rejected |
| Wildcard or suffix origins | A subdomain takeover or a user-content subdomain would receive the key. Origins are exact |
| Following redirects | A redirect can leave the allowed origin carrying the key. Redirects are returned to the caller, never followed |

## Enforcement

All of the following are added with the implementation (#246); until they merge this list is the target.

- Broker SSRF unit suite (`packages/vault-api/src/broker/`): every blocked IPv4 and IPv6 range including mapped forms, DNS returning one blocked address among valid ones, resolve-once and pinning (a second lookup is never made), no redirect following, header stripping in both directions, injection name rules and caps.
- Broker forward database spec with a local HTTPS upstream (a test certificate authority, never disabled verification): injection as header and as query, origin mismatch, disabled switches, rate limit, size and time caps, the upstream error codes, and the `broker.forward` audit row without a key, body, query or header.
- No-echo test: the key in the body, in a header, base64 and percent-encoded, and the `Basic` credential, each answering `502 BROKER_KEY_ECHO`.
- Token confinement conformance in `apps/api/test/conformance.spec.ts`: a `vbk_` token is refused on every route outside `/api/broker/v1/*`, `oat_` and sessions are refused on the broker, and `vbk_` and `oat_` are refused on the management and opt-in routes.
- `apps/api/test/rbac/vault-rbac-matrix.integration.spec.ts`: rows for the broker routes, the token routes and `PATCH /api/secrets/:id/broker-access`.
- Review item for any pull request that touches `packages/vault-api/src/broker/`: no route, log, span, error or audit row carries the key, the check order of decision 7 is kept, and no SSRF control of decision 8 is weakened.

## Threat model

| Threat | Control |
|---|---|
| Agent or caller reads the key | No route returns it; a `vbk_` token reaches only `/api/broker/v1/*`; the no-echo scan withholds a response that contains it (decisions 1, 9) |
| SSRF to internal services or cloud metadata | Exact HTTPS origins, validated at opt-in; every resolved address checked against the blocked ranges at call time (decisions 4, 8) |
| DNS rebinding | Resolve once, pin the connection to the validated address, never re-resolve (decision 8) |
| Redirect to another host with the key | Redirects never followed (decision 8) |
| Caller overrides or leaks the injection | Auth, cookie, proxy and `X-Vault-*` headers stripped; forbidden injection header names; injection set last (decisions 5, 8) |
| Upstream echoes the key to the caller | No-echo scan of body and headers, `Set-Cookie` dropped, fail closed (decision 9) |
| Man in the middle on the upstream | TLS verification always on, SNI and host name checked (decision 8) |
| Stolen `vbk_` token | Hash only at rest, shown once, secret restriction, expiry, revocation, rate limit, audit; confined to the broker (decisions 1, 7, 11) |
| Token mints tokens or opens secrets | Management and opt-in routes refuse `vbk_` and `oat_` (decisions 2, 3) |
| Foreign or hidden secret probing | One identical `404` for missing, foreign, closed or unsupported secrets (decision 7) |
| Resource exhaustion | Rate limit, request, response and time caps (decisions 7, 8) |
| Prompt-injected agent spends the key | Bounded, not removed: narrow origins, rate limit, audit, kill switches, per-secret opt-in (Consequences) |

## Related issues

#246 (this record, the implementation); [ADR-0002](0002-agent-access.md), [ADR-0005](0005-assistant-reveal.md); [security architecture, agent access](../SECURITY-ARCHITECTURE.md#16-oauth-server-agent-access); [agent credential API](../agent-credential-api.md).
