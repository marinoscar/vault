# Runbook: agent access

Operator and owner procedures for letting AI agents use Vault: enable it, connect an agent runtime or a chat assistant, open logins to agents, watch what they do, revoke an app, and turn everything off. Design and reasoning: [ADR-0002](../decisions/0002-agent-access.md), [ADR-0003](../decisions/0003-agent-cards-identity.md) (cards and identity, [below](#cards-and-identity-adr-0003)) and [SECURITY-ARCHITECTURE.md §16](../SECURITY-ARCHITECTURE.md#16-oauth-server-agent-access). Contract for runtime authors: [agent-credential-api.md](../agent-credential-api.md). The OAuth server itself is the platform's: its own runbook (hosts, reuse detection, failures) is [oauth-server.md in EnterpriseAppBase](https://github.com/marinoscar/EnterpriseAppBase/blob/main/docs/runbooks/oauth-server.md).

Examples use invented names: `https://vault.example.test` (your Vault), `https://app.example.test` (a website), "Agent runtime X", `person-a@example.test`.

## Two switches, both off by default

| Switch | Where | Permission | Effect while off |
|---|---|---|---|
| OAuth server | Admin settings, `OAuth clients` (`/admin/settings/oauth-clients`) | `oauth_clients:write` (Admin) | No client can complete an OAuth flow; `Connected apps` is hidden. Personal access tokens still work |
| Agent access | Admin settings, `Agents`, `Agent access` (`/admin/settings/agent-access`) | `system_settings:write` | Every `/api/agent/v1` route and every MCP `tools/call` answers `403 AGENT_ACCESS_DISABLED` |

Even with both on, an agent reaches only logins their owner opened to agents (below).

## Enable (administrator)

1. Open `/admin/settings/oauth-clients` and switch the OAuth server on.
2. Open `/admin/settings/agent-access`, switch "Allow agents to use opened logins" on, and review the per-minute limits (lookup 60, fill 30, one-time code 10, write 10 by default; each counts per app and person). Save.
3. Check the metadata: `curl -s https://vault.example.test/api/oauth/.well-known/authorization-server` returns JSON, and `curl -si https://vault.example.test/api/mcp -X POST` answers `401` with a `WWW-Authenticate` challenge.

The kill switch can also be set by API: `PATCH /api/system-settings` with `{ "agentAccess": { "enabled": true } }` (`system_settings:write`).

## Register an agent runtime (administrator)

A runtime such as "Agent runtime X" is a **confidential client**: it holds a secret on its server and runs authorization code with PKCE.

1. In `/admin/settings/oauth-clients` create a client: name "Agent runtime X", the runtime's exact redirect URI(s), grant types authorization code and refresh token, allowed scopes `vault:items_read`, `vault:items_fill`, `vault:items_write` (grant only what the runtime needs) and `offline_access`.
2. Copy the client secret shown once into the runtime's secret store. It is never shown again; rotate it from the same card if lost.
3. If the redirect host is refused, add it to the client host allowlist on the same page (the policy lists refused hosts so you can see what to allow). Allow only hosts you control or trust.
4. Give the runtime author [agent-credential-api.md](../agent-credential-api.md), the client id, and the resource `https://vault.example.test/api/agent/v1`.

Hosted assistants (Claude, ChatGPT) register themselves (client ID metadata document or dynamic registration) and are subject to the same host allowlist; allow their hosts if the consent page never appears.

## Connect a chat assistant over MCP

The MCP server is `https://vault.example.test/api/mcp` (Streamable HTTP, stateless). It searches, reads metadata, creates and updates secrets, and never returns a secret value. Agent access (above) must be on and the user must have opened the logins they want it to see.

| Client | Steps |
|---|---|
| Claude, ChatGPT (hosted) | Add a custom connector with the URL. The client discovers the authorization server from the `401` challenge, registers, and shows the consent page: `vault:mcp_read` is preselected, `vault:mcp_write` is a separate tick |
| Claude Code | `claude mcp add --transport http vault https://vault.example.test/api/mcp`, then `/mcp` to sign in. A personal access token also works as `--header "Authorization: Bearer <token>"` (full authority: prefer OAuth) |
| MCP Inspector | Transport "Streamable HTTP", the URL, then its OAuth flow; call `tools/list`, then each tool |

Verify: `tools/list` returns `search_secrets`, `get_secret`, `list_secret_types`, `create_secret`, `update_secret`. No tool result ever contains a password or code. Tool reference: [API.md MCP](../API.md#mcp-model-context-protocol).

## Open a login to agents (the owner)

Agent access is per secret and starts at none.

1. Create or open a `Credential` secret. Set its website (`url`, and `additional URLs` if the login works on more than one origin). The origins are stored in plaintext so Vault can find the login by website without decrypting; they hold only `scheme://host[:port]`.
2. Turn on "Allow agents to use this login" on the secret's page. Only `Credential` secrets can be opened; cards cannot.
3. Optional one-time codes: fill the "Authenticator key (TOTP)" field with an `otpauth://totp/...` URI or the base32 secret. The agent can then ask for the current code; it never receives the seed.
4. Turning the switch off closes the login to agents immediately (the next call is `404`).

## Read Agent activity (the owner)

Open `/settings/agent-activity`. Each row shows the app, the login, the website, the field, the purpose and whether it was allowed or refused (with the reason). Filter by action, login, app and date. No value, code or password is ever shown. The bell and email also report: a login an app created, a password it rotated, and the first use by a new app.

## Revoke an app

- **A person:** `/settings/connected-apps`, remove the app. Its next agent call answers `401`.
- **An administrator:** `/admin/settings/oauth-clients`, remove the grant (`DELETE /api/admin/oauth/grants/{id}`), or delete or disable the client to cut every grant of one app.
- **A personal access token:** revoke it where tokens are managed ([personal-access-tokens.md](../personal-access-tokens.md)).

If a refresh token is replayed the platform revokes the whole grant (reuse detection); ask the person to reconnect.

## Turn everything off

| Goal | Action |
|---|---|
| Stop all agent use of logins now, keep the connections | Agent access switch off. Every agent route and MCP tool call answers `403 AGENT_ACCESS_DISABLED` |
| Stop all third-party OAuth access | OAuth server switch off. No new flows, existing `oat_` tokens stop working. PATs are unaffected |
| Cut one app | Revoke its grant, or delete its client |
| Close one login | The owner switches "Allow agents to use this login" off |

Closing a login or switching off the kill switch needs no deploy and no restart.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `403 AGENT_ACCESS_DISABLED` | The Agent access switch is off | Administrator turns it on (above). This is the default |
| `403 ORIGIN_MISMATCH` | The `origin` sent is not exactly one of the login's origins (scheme, host and port; a subdomain is a different origin) | Owner adds the real site to the login's URL or additional URLs. Check for a look-alike site: a refusal may be correct |
| `403` with `WWW-Authenticate: ... error="insufficient_scope"` | The token lacks the scope (a read-only token calling fill, or `create_secret` without `vault:mcp_write`) | The client re-runs consent asking for the scope |
| `403 AGENT_CREDENTIAL_REQUIRED` | The call used a browser session | Use an `oat_` or `pat_` token |
| `403 AGENT_ACTIVITY_FORBIDDEN` | An OAuth token called `/api/agent-activity` | An agent cannot read its own trail: use the web page, a session or a PAT |
| `404` on lookup, fill or MCP | The login does not exist, is not the caller's, is not a `Credential`, or is **not opened to agents**. All look identical on purpose | Owner opens the login. A login created through MCP is visible to MCP only if created with `allowAgents: true` |
| `404` on the one-time code | The login has no usable TOTP seed | Add the authenticator key |
| `401` after working | The grant was revoked, expired or the token is expired | Refresh with the refresh token; if that fails, reconnect |
| `429 RATE_LIMITED` | Per-minute limit of that call type reached | Wait for `Retry-After`; raise the limit at Agent access if legitimate |
| `/api/secrets/...` returns `401` or `403` to an agent token | Route confinement: an `oat_` token works only under its resource prefix | Expected. Use `/api/agent/v1` or `/api/mcp` |
| Consent page never appears for a client | The client's host is not allowed, or the OAuth server is off | Check the client host allowlist and the OAuth server switch |
| An MCP tool result is `REDACTION_BLOCKED` | The guard found a sensitive value in the result and withheld it | Report it as a bug; the value was not sent |
| `update_secret` returns `FIELD_NOT_UPDATABLE` | `url` and `additional_urls` cannot be changed through MCP | The owner edits the website in Vault |

## Cards and identity (ADR-0003)

Card and identity release have their own switches, both **off** by default, separate from `agentAccess.enabled` ([ADR-0003](../decisions/0003-agent-cards-identity.md)).

1. **Enable (administrator).** Console, Agent access: turn on **Allow agents to use cards** and/or **Allow agents to fill identity details** (`agentAccess.cards.enabled`, `agentAccess.identity.enabled`; `system_settings:write`). The same page sets `cards.fillPerMinute` (default 10), `cards.releasesPerCardPerDay` (default 5, card numbers handed out per card per day) and `identity.fillPerMinute` (default 20). `agentAccess.enabled` must be on too.
2. **Runtime scopes.** A runtime must ask for `vault:cards_read` / `vault:cards_fill` and `vault:identity_read` / `vault:identity_fill`; tokens issued before this release carry only the login scopes and reach no card route (`403 insufficient_scope`). The user re-consents.
3. **Open a card (the owner).** On the card's page, Agent access: switch on **Allow agents to use this card**, then **Allow a shop**: the shop's website, the most per purchase and its currency, optional payment frames, an optional limit per day or month, an optional end date, and the security code (off by default). Nothing is released until a shop is allowed. Recommend a virtual card with its own limit.
4. **Requests.** An agent that finds no grant may ask for one; the owner gets a bell and an email and sees the request on the card with **Approve** (creates exactly the requested grant) and **Decline**.
5. **Open an identity item (the owner).** On the Identity item's page: switch on **Allow agents to fill these details** and add the websites that may receive the date of birth and the id number. Name, address and phone are filled on any website once the item is opened.
6. **Only the owner's session.** Opening a card or identity item, changing its websites, and every grant or request decision need the owner signed in to Vault: a personal access token or an agent token gets `403 OWNER_SESSION_REQUIRED`.
7. **Stop.** Revoke a shop on the card, close the card, or switch card release off for the deployment; each takes effect on the next call. Grants are not in backups: after a restore, owners re-create them.

| Symptom | Cause |
|---|---|
| `403 CARD_ACCESS_DISABLED` / `IDENTITY_ACCESS_DISABLED` | The card or identity switch is off |
| `GET /cards` is empty | The card is not opened, or has no live grant for that shop's registrable domain |
| `403 ORIGIN_MISMATCH` on a card | The page is another shop, or the payment frame is not on the grant's list |
| `403 CARD_AMOUNT_EXCEEDED` / `CARD_CURRENCY_MISMATCH` | The purchase does not fit the grant; the owner can allow a higher amount |
| `403 CARD_PERIOD_LIMIT_REACHED` / `CARD_DAILY_CAP_REACHED` | The grant's limit or the per-card daily cap was used up (UTC day or month) |
| `403 OWNER_SESSION_REQUIRED` | A token tried to open a card or change a grant; use Vault in the browser |
