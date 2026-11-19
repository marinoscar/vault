---
'@marinoscar/vault-contract': minor
---

Field model (issue #206, experimental): the `keyvalue` field type (reserved for system types: `createSecretTypeSchema` and `updateSecretTypeSchema` reject it with "keyvalue fields are reserved for system types"), with `keyValueEntrySchema`, `keyValueValueSchema` (at most 50 entries, unique snake_case keys) and `KEYVALUE_MAX_ENTRIES`; the optional field properties `format` (`country` | `multiline`, string fields only) and `mask` (`last4`, sensitive string fields only); `FIELD_TYPES`, `FIELD_FORMATS`, `FIELD_MASKS` and their types. `SecretTypeField` gains `keyvalue`, `format` and `mask`.
