---
'@marinoscar/vault-api': minor
---

Field model (issue #206): `SecretsService` validates a `format: 'country'` string as an ISO 3166-1 alpha-3 code (upper-cased before validating, stored upper-cased; `isCountryCode` of `@marinoscar/vault-contract/common`) and a `keyvalue` value with `keyValueValueSchema` (a required one needs at least one entry) and stores the list as-is in the encrypted JSON; error messages name the field and entry, never a value. A data update equal to the current version's data (key order aside) no longer creates a version (`dataChanged: false`). MCP renders a `keyvalue` value as `label: value` lines, a sensitive entry as `label: [withheld]` (new `WITHHELD`), and reports every sensitive entry value to the fail-closed guard. The HTML export renders a `keyvalue` value as an escaped two-column table.
