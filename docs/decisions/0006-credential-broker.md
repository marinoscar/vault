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

1. **A broker token, `vbk_`.** `vbk_` plus 40 random base62 characters, created by the owner, shown once and stored only as a SHA-256 hash (`broker_tokens`, with a display prefix of the first 12 characters). It is accepted only on `/api/broker/v1/*`; every other credential route refuses it. It can use keys and can never read them. Optional restriction to specific secret ids (at most 100, each the owner's own broker-enabled secret, else `422 BROKER_TOKEN_SECRET_INVALID`; empty means every broker-enabled secret of the owner), a required expiry of 1 to 3650 days (default 90: there is no token without one), revocable, `last_used_at` stamped on use at most once a minute per token. A user saves one `vbk_` token as the proxy-injected network secret for the Vault host in a Claude cloud environment, so the sandbox never holds a key.
2. **Who may call the broker.** A `vbk_` token or a personal access token (`pat_`, which already carries the owner's full authority, for the CLI and scripts). `oat_` tokens and browser sessions are refused in v1 (`403 BROKER_CREDENTIAL_REFUSED`, without looking the credential up, and not audited because no user is identified; an unknown, revoked or expired `vbk_` token is a `401`); an OAuth resource for the broker is a deferred follow-up. Broker-token management (`POST/GET /api/broker/tokens`, `POST /api/broker/tokens/:id/revoke`, `DELETE`) accepts a session or a PAT only: an `oat_` token is refused (`403`) and a `vbk_` token cannot authenticate there at all (`401`), so a token cannot mint or revoke tokens. Audited `broker.token.create` and `broker.token.revoke`; the list never returns the token or its hash.
3. **Per-secret owner opt-in, default off.** `PATCH /api/secrets/:id/broker-access { enabled, origins?, injection?, field? }` needs `secrets:write` and ownership (looked up by creator; `secrets:write_any` does not help), session or PAT; `oat_` and `vbk_` are refused. The state lives on the secret: `broker_access` (default `false`), `broker_origins` (1 to 20 exact HTTPS origins), `broker_injection`, `broker_field`, `broker_access_changed_at`. Supported types are the system `API Key`, `Token` and `Service Key`, and custom types with at least one sensitive string field: the only one, or the one `field` names (several and none named, or a `field` that is not a sensitive field of the type, answers `422 BROKER_FIELD_INVALID`). Every other system type and any type with a cvv-like field (the assistant-reveal exclusions) answers `422 BROKER_UNSUPPORTED_TYPE`. Origins, injection and field not sent keep their stored values; turning the switch off keeps them for next time. Turning the switch off is always allowed. Enabling needs at least one origin (`422 BROKER_ORIGINS_REQUIRED`). Audited `secret.broker_access.update` with from/to, origins and the injection kind and name, never a value.
4. **Origins are exact and validated.** An origin is `https://host[:port]`, lowercase host, no userinfo, path, query or fragment; the default port is dropped (`:443` normalizes away), so "equal" is a string comparison of two normalized values. Refused with `422 BROKER_ORIGIN_INVALID`: another scheme, `localhost` and any `*.localhost`, `*.local` or `*.internal` name, a single-label host, a trailing dot, an invalid host name, and an IP literal the platform's `isBlockedAddress` blocks (a public IP literal is allowed). There are no wildcards and no prefix matches. The `:upstreamHost` path segment must be a plain `host[:port]` or a bracketed IPv6 literal with an optional port; anything else (`@`, a slash, a percent escape) is an origin mismatch.
5. **Injection shapes are a closed set.** `{ kind: 'header', name, prefix? }` with `name` matching `^[A-Za-z0-9-]{1,64}$` and `prefix` one of empty, `Bearer`, `Token`, `Basic`, `Bot`, `ApiKey` (with `Basic` the stored key is `user:password` and the injected value is `Basic base64(user:password)`); or `{ kind: 'query', name }` with `name` matching `^[A-Za-z0-9_.-]{1,64}$`. A header named `host`, `cookie`, `set-cookie`, `content-length`, `transfer-encoding`, `connection`, `upgrade`, `proxy-*`, `forwarded`, `x-forwarded-*`, `x-real-ip` or `x-vault-*` is refused. An unset injection means `Authorization: Bearer`. A caller's header or query parameter of the injected name is replaced, never duplicated.
6. **The endpoint is path-form.** `ALL /api/broker/v1/:secretId/:upstreamHost/*` forwards to `https://{upstreamHost}/{rest}?{query}`; `upstreamHost` may carry `:port`. The origin `https://{upstreamHost}` must equal one of the secret's `broker_origins` exactly. The form lets an SDK need only a base URL: `https://vault.example.test/api/broker/v1/<secretId>/api.service-x.example`. Methods are `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS` (others `405`). The raw upstream response is returned, not wrapped in the `{ data }` envelope (as the export zip is not). The route is `@Public()` to the platform and authenticated by its own guard; the request body is read as a raw stream (the host calls `installBrokerRawBody(fastify)`, as `apps/api/src/main.ts` does) and never parsed.
7. **Checks run in a fixed order, fail closed, before any decryption:** credential kind (`vbk_` or `pat_`); `agentAccess.enabled` and `agentAccess.broker.enabled` (`403 BROKER_DISABLED`); rate limit `agentAccess.broker.forwardsPerMinute` per token and user (`429 RATE_LIMITED` with `Retry-After`); token restricted to this secret; secret owned by the caller, `broker_access` true, a supported type and a valid injection (otherwise one identical `404`, no oracle); origin match (`403 BROKER_ORIGIN_MISMATCH`); the announced `Content-Length` against `maxRequestBytes` (`413`); DNS and the blocked-address check (`403 BROKER_DESTINATION_BLOCKED`); only then decrypt the one field of the current version (`422 BROKER_KEY_MISSING` when it is empty or holds a line break or null character) and forward. Every refusal after the credential is audited (`broker.forward`).
8. **SSRF controls, all required.**
   - HTTPS only; the port comes from the origin (default 443). TLS certificate and host name verification are never disabled; `servername` is the host.
   - DNS is resolved once (`dns.lookup(host, { all: true })`; an IP literal is not resolved). If ANY returned address is blocked, the call is refused (`403 BROKER_DESTINATION_BLOCKED`). The check is the platform's `isBlockedAddress` of `@marinoscar/platform-api/core` (`ip-classify`), not a Vault list: it blocks every address that is not a public unicast one, among them IPv4 `0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`, the documentation ranges, `192.168/16`, `198.18/15`, `224/4`, `240/4`, and for IPv6 the unspecified, loopback, unique-local, link-local, multicast and documentation ranges and every form that embeds an IPv4 address (`::ffff:`, `64:ff9b::/96`, `2002::/16`), judged by the IPv4 address it carries. A host that resolves to no address is `502 BROKER_UPSTREAM_ERROR`.
   - The only exception is a constructor option of `BrokerForwardService`, `allowLoopbackForTests` (loopback only; every other range stays blocked), supplied through the `BROKER_FORWARD_OPTIONS` token that is exported only from `@marinoscar/vault-api/testing`. There is no `NODE_ENV` or environment-variable switch, and the production module graph binds no such option (proven in `apps/api/test/broker/broker-confinement.spec.ts`).
   - The connection is pinned to the first validated address with a custom `lookup`, so a second resolution (DNS rebinding) cannot change the destination; no connection is reused (`agent: false`), TLS is 1.2 or later.
   - Redirects are never followed; a `3xx` is returned as is, with `Location` passed through.
   - Request headers are stripped of `Authorization`, `Cookie`, `Host`, `Proxy-*`, `Forwarded`, `X-Forwarded-*`, `X-Real-IP`, `X-Vault-*`, the hop-by-hop headers (`Connection`, `Keep-Alive`, `TE`, `Trailer`, `Transfer-Encoding`, `Upgrade`) and `Expect` and `Accept-Encoding`; the upstream `Host` is the origin's host (and port when not 443), never the caller's, and the injection is set last, so a caller cannot choose or override it. The request body is streamed through a byte counter (never buffered whole); `Content-Length` is passed through and a chunked body stays chunked.
   - Caps, from settings: `maxRequestBytes` (default 10 MiB, `413 BROKER_REQUEST_TOO_LARGE`, by `Content-Length` before sending and by the counter while streaming), `maxResponseBytes` (default 25 MiB, `502 BROKER_RESPONSE_TOO_LARGE`, applied to the wire bytes and again to the decoded body), `timeoutMs` (default 30000, `504 BROKER_UPSTREAM_TIMEOUT`, covering DNS and the exchange). A connection failure answers `502 BROKER_UPSTREAM_ERROR` with no internal detail and no address.
9. **No echo, fail closed.** Vault forces `Accept-Encoding: identity`; if the upstream compresses anyway (gzip, deflate, br) the body is decoded up to `maxResponseBytes` before scanning, and the decoded body is returned without `Content-Encoding` (an unknown encoding is `502 BROKER_UPSTREAM_ERROR`). The response is buffered and scanned for the key, its base64, base64url and unpadded base64 forms, its percent-encoded form (both hex cases), the exact injected value (the whole `Basic ...` header value or the `name=key` query pair) and the base64 of that value. If any appears in the body or in any header name or value, the **whole response is withheld** (`502 BROKER_KEY_ECHO`; a header is not merely dropped) and the event audited. Otherwise the status, the filtered headers (`Set-Cookie`, hop-by-hop headers, `Content-Length` and `Content-Encoding` are dropped) and the body are returned with `X-Vault-Broker: 1`.
10. **Settings, off by default.** `agentAccess.broker = { enabled: false, forwardsPerMinute: 60, maxRequestBytes: 10 MiB, maxResponseBytes: 25 MiB, timeoutMs: 30000 }` (ranges 1 to 10000, 1 byte to 100 MiB twice, 1000 to 120000 ms) is an additive, optional part of the agent-access settings, edited on `/admin/settings/agent-access`. Two switches must be on to forward: the existing `agentAccess.enabled` kill switch and `agentAccess.broker.enabled`.
11. **Audit and visibility.** Every call, allowed or refused, writes `broker.forward`: secret id, token id and kind (never the token), upstream origin, method, path without the query string, status, request and response byte counts, duration and outcome. Never the key, the body, the query or any header. Refusals by credential kind (an `oat_` token, a session, an unknown `vbk_` token) are not audited, because no user is identified; every refusal that identifies a user is. Agent activity shows the action `broker_forward`, "Used through the broker", with origin, method and status. The owner sees the opt-in in the web app (a switch with a confirmation, the allowed origins, the injection shape, a "Broker" chip in the list) and manages tokens in a "Broker tokens" settings card.
12. **Not a queue job.** A forward completes within the HTTP request and its `timeoutMs`; it is not long-running work in the sense of the queue rule.
13. **Everything else from ADR-0002 and ADR-0005 holds.** The agent REST API still returns at most one sensitive field per call, an `oat_` token never reaches `/api/secrets/*`, and the broker returns no key through any route, only the upstream's response.

## Consequences

- **Vault becomes an egress point.** Operators must accept outbound HTTPS traffic from the API host to every origin an owner allows, and may need to allow it in network policy. The feature is off until an administrator switches it on.
- **Responses pass through Vault and are buffered** up to `maxResponseBytes` so they can be scanned. This costs memory and latency, and large or streaming responses are not supported.
- **A stolen `vbk_` token can spend keys against their allowed origins until revoked.** The damage is bounded by the origin allowlist, the per-minute rate limit, the optional secret restriction and expiry, revocation, and an audit row per call. It cannot read a key and cannot reach any other route.
- **The agent still sees the API responses.** Data the upstream returns enters the agent's context. The broker protects the key, not the data behind it.
- **Prompt injection can make an agent call an allowed API with the owner's key.** A model steered by a hostile page can send any request the key permits to an allowed origin. The controls bound this and do not remove it. Owners should allow narrow origins and opt in scoped, cheap-to-rotate keys.
- **Rotation works.** The key lives in one place; updating the secret in Vault changes what the next forward injects, and no sandbox holds a copy.
- **Echo detection is best effort for transformed keys.** A response that encodes the key in a form not listed (for example a hash, a split value or another character encoding) is not caught. The origin allowlist is what limits who could echo it.
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

Implemented with #246. Package unit specs, in `packages/vault-api/src/broker/` (and `packages/vault-contract/test/broker.test.ts` for the wire shapes and codes):

- `broker-address.spec.ts`: the blocked IPv4 and IPv6 ranges through the platform check, mapped forms.
- `broker-origin.spec.ts`: origin normalization and refusal rules, the `:upstreamHost` shape.
- `broker-upstream.spec.ts`: resolve-once and pinning, TLS verification on, no redirect following, response cap and timeout.
- `broker-http.spec.ts`: header stripping in both directions, injection (header, query, `Basic`), echo needles.
- `broker-forward.service.spec.ts`: the check order, the 404 oracle, every error code, decoding and the echo scan, the audit row without a key, body, query or header.
- `broker-auth.guard.spec.ts`, `broker-tokens.service.spec.ts`, `broker-token.spec.ts`, `broker-types.spec.ts`, `broker-raw-body.spec.ts` and `packages/vault-api/src/secrets/secrets-broker-access.spec.ts`: credential kinds, token lifecycle and the `last_used_at` throttle, supported types, the raw body hook, the opt-in route.
- `packages/vault-api/test/conformance.spec.ts`: the broker controller is `@Public()` and guarded by `BrokerAuthGuard` alone.

Host specs, in `apps/api/test/`:

- `broker/broker.db.spec.ts`: the whole path against a local HTTPS upstream with a test certificate authority (verification never disabled): injection, caps, rate limit, kill switches, echo in body and header, redirects, secret egress.
- `broker/broker-confinement.spec.ts`: a `vbk_` token is a `401` on every other route, `oat_` and sessions are refused on the broker, `vbk_` is refused on the management and opt-in routes, and the test-only `BROKER_FORWARD_OPTIONS` is bound nowhere in the production module graph.
- `rbac/vault-rbac-matrix.integration.spec.ts`: rows for `PATCH /api/secrets/:id/broker-access` and the four token routes.
- Web: `packages/vault-web/test/secrets/BrokerAccess.test.tsx`, `packages/vault-web/test/agent/BrokerTokensPage.test.tsx`; CLI: `apps/cli/src/vault/__tests__/secrets-broker.test.ts`.
- Review item for any pull request that touches `packages/vault-api/src/broker/`: no route, log, span, error or audit row carries the key, the check order of decision 7 is kept, and no SSRF control of decision 8 is weakened.

## Threat model

| Threat | Control |
|---|---|
| Agent or caller reads the key | No route returns it; a `vbk_` token reaches only `/api/broker/v1/*`; the no-echo scan withholds a response that contains it (decisions 1, 9) |
| SSRF to internal services or cloud metadata | Exact HTTPS origins, validated at opt-in; every resolved address checked against the blocked ranges at call time (decisions 4, 8) |
| DNS rebinding | Resolve once, pin the connection to the validated address, never re-resolve (decision 8) |
| Redirect to another host with the key | Redirects never followed (decision 8) |
| Caller overrides or leaks the injection | Auth, cookie, proxy and `X-Vault-*` headers stripped; forbidden injection header names; injection set last (decisions 5, 8) |
| Upstream echoes the key to the caller | Decoded no-echo scan of body and headers (raw, base64, base64url, percent-encoded, injected value), the whole response withheld, `Set-Cookie` dropped, fail closed (decision 9) |
| Man in the middle on the upstream | TLS verification always on, SNI and host name checked (decision 8) |
| Stolen `vbk_` token | Hash only at rest, shown once, secret restriction, expiry, revocation, rate limit, audit; confined to the broker (decisions 1, 7, 11) |
| Token mints tokens or opens secrets | Management and opt-in routes refuse `vbk_` and `oat_` (decisions 2, 3) |
| Foreign or hidden secret probing | One identical `404` for missing, foreign, closed or unsupported secrets (decision 7) |
| Resource exhaustion | Rate limit, request, response (wire and decoded) and time caps (decisions 7, 8, 9) |
| Prompt-injected agent spends the key | Bounded, not removed: narrow origins, rate limit, audit, kill switches, per-secret opt-in (Consequences) |

## Related issues

#246 (this record, the implementation); operator and owner procedures: [credential broker runbook](../runbooks/credential-broker.md); [ADR-0002](0002-agent-access.md), [ADR-0005](0005-assistant-reveal.md); [security architecture, agent access](../SECURITY-ARCHITECTURE.md#16-oauth-server-agent-access); [agent credential API](../agent-credential-api.md).
