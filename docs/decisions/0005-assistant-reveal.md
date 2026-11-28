# ADR-0005: Assistant reveal: an owner can let a chat assistant read one field of a chosen secret

- Status: Accepted
- Date: 2026-11-28
- Related issues: #244; amends decision 6 of [ADR-0002](0002-agent-access.md)

## Context

[ADR-0002](0002-agent-access.md) decision 6 made MCP value-free: no tool result carries a secret value, because a result enters the model's context, which leaves Vault's control for good (provider logs, conversation history, a later tool call). That kept the risk small, but it left an owner who connects a chat assistant with a real need unmet: the assistant helps with a task (configure a service, call an API) and needs one value of a secret the owner chose, for example an API key.

The only workaround was a personal access token (`pat_`) given to the assistant or to a CLI it drives. A PAT has the owner's full authority, no scopes, no per-secret choice and no consent screen, which is a much larger exposure than one field of one secret. ADR-0002 said a `reveal_secret` tool "would need its own decision". This is that decision.

## Decision

1. **Per-secret owner opt-in, default off.** `secrets.assistant_reveal` (boolean, default `false`, with `assistant_reveal_changed_at`) says whether an assistant may read the secret's fields one at a time. Every secret starts closed, including all that existed before. It is separate from `agent_access` (the REST fill gate): opening a login to runtimes does not reveal it to assistants, and the reverse.
2. **Only the owner, only with a session or a PAT.** `PATCH /api/secrets/:id/assistant-reveal { enabled }` needs `secrets:write` and ownership; `secrets:write_any` does not help, so an administrator cannot open someone else's secret. An `oat_` token is refused (`403`), so an assistant cannot open a secret for itself. Audited `secret.assistant_reveal.update`.
3. **Types that can never be revealed.** Card, Passport, ID Document and any type with a cvv-like field (`cvv`, `cvc`, `security_code`): the toggle answers `422 ASSISTANT_REVEAL_UNSUPPORTED_TYPE` and the tools treat them as missing. One definition (`isMcpExcludedType`) serves MCP and the toggle.
4. **A separate, high-risk OAuth scope.** `vault:mcp_reveal` on the `mcp` resource, permission `secrets:read`, risk high, never selected by default. Reading metadata (`vault:mcp_read`) never reveals a value. An existing connector reconnects to add the scope.
5. **One tool, one field per call.** `reveal_secret { id, field }` returns `{ id, name, type, field, value }` for one field of the caller's own secret with reveal on. A missing, foreign, closed or excluded secret is one identical not-found; `FIELD_NOT_FOUND` and `FIELD_EMPTY` are answered only after the secret is proven revealable, so they are no oracle. `search_secrets` and `get_secret` also list revealable secrets (values stay `[hidden]`, the item carries `assistantReveal`) so the assistant can find them. `update_secret` is unchanged.
6. **The redaction guard stays fail-closed.** Every value `reveal_secret` decrypts is still reported to the dispatcher; only that tool is exempt, and only for its top-level `value` key. The same value anywhere else in the result, or any other field of the secret, still withholds the result (`REDACTION_BLOCKED`).
7. **Own rate limit.** `agentAccess.revealPerMinute` (default 10, 1 to 10000) in its own bucket, counted before the lookup, per grant (or PAT) and user. The kill switch `agentAccess.enabled` covers the tool (`403 AGENT_ACCESS_DISABLED`).
8. **Audit and visibility.** `mcp.tool.call` carries the field **name** (never the value). Agent activity shows the action `mcp_reveal`, "Revealed to an assistant". The owner sees the opt-in in the web app: a "Reveal to assistants" switch with a confirmation dialog, a "Revealed" chip in the list.
9. **Everything else from ADR-0002 holds.** `url` and `additional_urls` cannot be changed over MCP; generated passwords are still never returned; Cards and identity documents are out of scope; an `oat_` token never reaches `/api/secrets/*`.

## Consequences

- **A revealed value enters the model's context and cannot be recalled.** Provider logs and conversation history may keep it. The owner accepts this per secret, with a confirmation dialog that says so.
- **Prompt injection can still read opted-in secrets.** A model steered by a hostile page or document can call `reveal_secret` on any opted-in secret within the rate limit. The controls bound the damage: per-secret opt-in, a separate high-risk scope, one field per call, the rate limit, an audit row per call, the kill switch and per-app revocation. Owners should opt in secrets that are cheap to rotate (a scoped API key), not a master password.
- **The "never a value over MCP" statement of ADR-0002 is now "never a value except `reveal_secret`".** Operator and owner docs, the tool descriptions and the server instructions say so.
- **Two toggles per login.** A Credential can be opened to runtimes (`agent_access`) and revealed to assistants (`assistant_reveal`) independently. That is friction by design.
- **A contract addition.** `agentAccess.revealPerMinute` is an optional settings field and `mcp_reveal` an activity action of the agent contract: additive, no version bump ([agent-credential-api.md](../agent-credential-api.md#8-changes)).
- **Rate limits are in process memory**, as in ADR-0002.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| A personal access token and the CLI (status quo workaround) | Full authority, no scopes, no per-secret choice, no consent screen, no per-app revocation. Strictly larger exposure than one field of one secret |
| A network secret per key (the platform injects the key into outbound calls) | Fits a call to a known host, not "tell the assistant a key to paste somewhere"; needs an environment change per key and an administrator |
| Keep MCP value-free (status quo) | Safe, but pushes owners to a PAT, which is worse |
| Per-call approval through MCP elicitation | Not supported by all clients and weakens unattended use. A possible future hardening on top of this decision (ask the owner to approve each reveal), not a replacement for the per-secret opt-in |
| Reveal by scope alone, no per-secret opt-in | One over-broad token would expose the whole vault; the owner's choice per secret must be the boundary, as in ADR-0002 |
| Reveal several fields or the whole record | More of the secret in the model's context than needed. One field per call |

## Enforcement

- `packages/vault-api/src/mcp/reveal-secret.spec.ts` covers the tool: not-found for missing, foreign, closed and excluded secrets, the field errors, the redaction exemption limited to `value`, the rate limit bucket, the scope and the audit row without a value.
- `packages/vault-api/src/secrets/secrets-assistant-reveal.spec.ts` covers the toggle: owner only, `oat_` refused, the excluded types (422), the list filter and the audit.
- `apps/api/test/rbac/vault-rbac-matrix.integration.spec.ts` lists the route; `apps/api/test/conformance.spec.ts` runs the `oauth-server` suite per resource with the new scope.
- `packages/vault-contract/test/agent-contract/snapshot.json` pins the additive contract change.
- Review item for any pull request that touches `packages/vault-api/src/mcp/`: no tool other than `reveal_secret` returns a sensitive value, the exemption stays one top-level key, and no excluded type becomes revealable.

## Related issues

#244 (this record, the implementation); [ADR-0002](0002-agent-access.md) (decision 6, amended), [ADR-0003](0003-agent-cards-identity.md), [ADR-0004](0004-identity-documents.md).
