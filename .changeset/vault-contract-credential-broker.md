---
'@marinoscar/vault-contract': minor
---

Add the credential broker contract (issue #246, ADR-0006): the `./broker` entry point (injection, opt-in and broker token schemas, `vbk_` constants, `BROKER_ERROR_CODES`, audit action names), the `BROKER_*` error codes in `./errors`, `agentAccess.broker` settings (off by default) and `agentBrokerSettingsSchema` in `./agent`, the `broker_forward` activity action with `method` and `status` on an item and the `broker` credential kind, and the `brokerAccess` list filter in `./secrets`. All additive.
