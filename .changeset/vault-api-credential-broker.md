---
'@marinoscar/vault-api': minor
---

Add the credential broker slice (issue #246, ADR-0006): `ALL /api/broker/v1/:secretId/:upstreamHost/*` forwards a request with a stored key added server-side (HTTPS only, exact allowed origins, every resolved address checked, connection pinned, no redirects, size and time caps, no-echo scan), `POST/GET/DELETE /api/broker/tokens` and `POST /api/broker/tokens/:id/revoke` manage `vbk_` tokens, and `PATCH /api/secrets/:id/broker-access` is the owner's opt-in. A host calls `installBrokerRawBody(fastify)` once before the application initialises. Audited as `broker.forward`; Agent activity shows `broker_forward`.
