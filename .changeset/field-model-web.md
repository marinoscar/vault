---
'@marinoscar/vault-web': minor
---

Field model (issue #207): new `KeyValueFieldEditor` and `CountryField` components (`secrets/ui`); `DynamicSecretFields` edits and lists `keyvalue` fields, `format: 'country'` and `format: 'multiline'`; `SecretValueField` shows the `last4` mask and one row per `keyvalue` entry with its own reveal (same 30 s auto-hide) and copy; the version drawer masks sensitive entries unless "Show values" is on; validation, cleaning, diffing and copy handle entry arrays and country codes. New `secrets/headless` helpers: `maskLast4` (the card number mask now calls it), the `keyvalue` and country helpers. `FieldDefinition` and `KeyValueEntry` are re-exported from `@marinoscar/vault-contract/secret-types`. A card field's copy formatting now applies only to a digits-shaped value, so a `number` with letters (a document number) copies as stored.
