---
'@marinoscar/vault-api': minor
---

Identity documents (issue #209): the metric label vocabulary `SECRET_TYPE_KINDS` gains `passport` and `id_document`. MCP never handles the `Passport` and `ID Document` system types: `isCardLikeType` is renamed `isMcpExcludedType` and excludes `Card`, `Passport`, `ID Document` and any cvv-like type from `list_secret_types`, `create_secret` (`TYPE_NOT_SUPPORTED`) and the get/update lookup. Agent access stays closed: opening either type to agents answers 422 `AGENT_ACCESS_UNSUPPORTED_TYPE`.
