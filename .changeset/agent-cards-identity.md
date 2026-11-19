---
'@marinoscar/vault-contract': minor
'@marinoscar/vault-db': minor
'@marinoscar/vault-api': minor
'@marinoscar/vault-web': minor
---

Agent release of payment cards and identity fields, with per-merchant rules (ADR-0003, #195).

- `@marinoscar/vault-contract`: card and identity agent schemas (`agentCardFillRequestSchema`, `agentCardSummarySchema`, `agentCardGrantRequestCreateSchema`, `agentIdentityFillRequestSchema`, `agentIdentitySummarySchema`), the owner's merchant grant and grant request shapes (`createCardGrantSchema`, `cardGrantSchema`, `cardGrantRequestSchema`), amount and currency schemas and helpers, scopes `vault:cards_read|fill` and `vault:identity_read|fill`, new error codes, the `cards` and `identity` blocks of the `agentAccess` settings (both off by default) with `resolveAgentAccessSettings`, the `Identity` system secret type and the Card's optional `billing_postal_code`.
- `@marinoscar/vault-db`: migration `add_agent_card_grants` (tables `agent_card_grants`, `agent_card_grant_requests`, `agent_card_releases`; column `secrets.agent_origins`).
- `@marinoscar/vault-api`: `AgentReleasePort` / `AGENT_RELEASE_PORT` / `AgentReleaseService`, the in-process port an embedding host calls, shared with the HTTP controllers; `AgentCallPipeline`; card routes (`GET /api/agent/v1/cards`, `POST /cards/:id/fill`, `POST /cards/:id/grant-requests`) and identity routes (`GET /identity`, `POST /identity/:id/fill`) with merchant grants (registrable-domain match, payment frames, amount and currency, period limit, per-card daily cap, security code flag), their own rate-limit buckets and kill switches; the owner's grant routes under `/api/secrets/:id/card-grants` and `/card-grant-requests` (browser session only); a Card or Identity can be opened to agents (browser session only) and an Identity takes allowed origins; card notifications and activity; permissions `agent_cards:*` and `agent_identity:*`.
- `@marinoscar/vault-web`: the card's Agent access panel (open or closed, merchant grants with limits and use, pending requests with Approve and Decline, the allow-a-shop form), the identity panel (open or closed, allowed websites), card and identity switches and limits on the Agent access settings page, and the new activity actions with amounts.
