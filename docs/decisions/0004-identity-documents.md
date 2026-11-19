# ADR-0004: Identity documents and document scanning

- Status: Accepted
- Date: 2026-11-19
- Related issues: epic #203; #209 (this record, the system types and the kind catalog); #204, #205, #206, #207, #208, #210, #211, #212, #213, #214 (the rest of the epic); builds on [ADR-0003](0003-agent-cards-identity.md)

## Context

Vault keeps cards with their photos and can fill a card from a photo, but it has no place for identity documents: a passport, a driver license, a residence card, a Global Entry card, a Social Security card, a health insurance card. People keep photos of these in a camera roll or a notes app, with no expiry reminders, no versioning and no encryption.

The `Identity` system type of [ADR-0003](0003-agent-cards-identity.md) is not that place. It is a **form-fill profile** an agent may be given: a name, a date of birth, one id number and an address. It has no images, no document kind and no dates, and it is released to agents on purpose.

Identity documents vary widely. A passport follows one international layout (ICAO 9303) with a machine-readable zone. Every other document is local: a driver license has classes and restrictions, an insurance card has a member id and pharmacy routing numbers, a vehicle registration has a VIN. A typed system type per document would mean dozens of types, a new one for every country, and an empty field list for most of them.

The question is how to model these documents, what they share with cards (images, scanning, expiry), and what they must never share with logins, cards and the Identity profile (release to agents).

## Decision

1. **Two new system types, separate from `Identity`.** `Identity` is unchanged.
   - **`Passport`** (icon `TravelExplore`), with typed fields: `surname`, `given_names`, `passport_number`, `passport_type`, `issuing_country`, `nationality`, `date_of_birth`, `place_of_birth`, `sex`, `issue_date`, `expiry_date`, `issuing_authority`, `personal_number`, `mrz`, `notes`. Required: `surname`, `passport_number`, `expiry_date`. Sensitive: `passport_number` (shown with `mask: last4`), `date_of_birth`, `personal_number`, `mrz`.
   - **`ID Document`** (icon `AssignmentInd`), one generic type for every other document: `document_kind`, `holder_name`, `document_number`, `issuing_country`, `issuing_authority`, `date_of_birth`, `issue_date`, `expiry_date`, `attributes`, `notes`. Required: `document_kind`, `holder_name`. Sensitive: `document_number` (`mask: last4`), `date_of_birth`.
   - `date_of_birth` is sensitive in both, as in `Identity`. Country fields use `format: country` (ISO 3166-1 alpha-3, the code an MRZ prints).
   - Both are appended to `SYSTEM_SECRET_TYPES` and seeded by name; their fields are append-only like every system type's.
2. **A kind catalog plus a `keyvalue` field, not a type per document.** `document_kind` is a `select` over `ID_DOCUMENT_KINDS` (Driver License, National ID, Permanent Resident Card, Trusted Traveler Card, Social Security Card, Health Insurance Card, Visa, Work Permit, Residence Permit, Vehicle Registration, Military ID, Student ID, Other). Kind-specific details go in `attributes`, a `keyvalue` field (system types only, issue #206) whose entries carry their own `sensitive` flag. `ID_DOCUMENT_KIND_CATALOG` in `@marinoscar/vault-contract/secret-types` gives each kind its **standard keys** (what the form suggests and the scan asks for), its **checks** and its **expiry lead days**. The kind list and each kind's keys are append-only; an owner may add any other entry.
3. **No agent or MCP release.** Neither type can be opened to agents: `PATCH /api/secrets/:id/agent-access { agentAccess: 'fill' }` answers `422 AGENT_ACCESS_UNSUPPORTED_TYPE`, from a token or a browser session. MCP treats both like a card (`isMcpExcludedType`): not in `list_secret_types`, refused by `create_secret` (`TYPE_NOT_SUPPORTED`), not found for `get_secret` and `update_secret`. A form that needs a name or a date of birth uses the `Identity` profile, which the owner opens deliberately.
4. **Images are slots of the type.** A Passport has `data_page` (required) and `back`; an ID Document has `front` (required) and `back` (`DOCUMENT_IMAGE_SLOTS`, issue #208). The image rules of a card (MIME list, size cap, measured size, reveal and auto-hide in the UI) apply to every document image.
5. **Checks warn, they never block.** The deterministic checks (`DOCUMENT_CHECK_IDS`: `mrz` check digits on `mrz` / `attributes.mrz`, `ssn` structure on a Social Security Card's `document_number`, `vin` check digit on `attributes.vin`; issue #205) catch a misread character from the vision model. A failed check is a warning on the review screen and the owner decides; a save is never refused because a check failed, since a real document can fail a check (an old card, a typo the issuer made).
6. **Scanning is an assistant, and the model is the deployment's choice.** Document scanning (issues #210, #211) uses the platform AI slice like card scanning: server-side only, keys never leave the server, the model's answer is a draft the owner reviews, nothing is saved until the owner saves it, and the photos are disclosed as leaving for the configured provider. The model is an administrator setting with a card-scan fallback. Availability follows the model's declared capabilities (vision input, structured output), not a provider name, so a deployment can run scanning on an on-prem OpenAI-compatible vision model with no key and no image leaving the network (issue #213). Without AI, both types are entered by hand.

## Consequences

- Easier: one generic type covers every non-passport document, in any country, with no schema change and no new type; a new kind is a catalog entry. Expiry reminders (issue #212) read one `expiry_date` and the catalog's lead days.
- Easier: the agent and MCP surfaces need no new review. They stay exactly as wide as before.
- Harder: `attributes` is untyped beyond key, label, value and sensitivity. A kind's standard keys are suggestions, so two secrets of the same kind may use different keys for the same detail. The scan uses the standard keys, which keeps most of them consistent.
- Harder: `Identity` and the two document types overlap (a name, a date of birth, a number). The owner may keep both; nothing copies one into the other.
- Risk accepted: a document photo is personal data sent to the AI provider when the owner scans. It is disclosed in the UI, opt-in per scan, and avoidable with an on-prem model or by typing.

## Alternatives considered

- **Extend `Identity` with images and dates.** Rejected: `Identity` is released to agents (ADR-0003). Mixing a profile an agent may read with the photos and numbers of every document would make every document as exposed as the profile, or make the profile useless to agents.
- **One system type per document kind.** Rejected: dozens of types, most fields empty or country-specific, a migration-free but ever-growing system type list, and a type picker nobody can scan.
- **A single "ID Document" type including passports.** Rejected: a passport has a fixed international layout, an MRZ and its own lead days (many countries refuse entry with less than six months left); typed fields make it searchable and checkable.
- **Checks that block a save.** Rejected: a check can be wrong for a real document, and the owner must be able to keep what is printed on it.

## Enforcement

- `packages/vault-contract/test/id-documents.test.ts` pins the kinds, each kind's standard keys, checks and lead days, `PASSPORT_EXPIRY_LEAD_DAYS`, and both types' fields, required and sensitive flags, formats and masks.
- `packages/vault-api/src/ai/scan/checks/document-check-ids.spec.ts` pins `DOCUMENT_CHECK_IDS` equal to the check library's `CheckId`, at compile time and at run time.
- `packages/vault-api/src/secret-types/system-secret-types.spec.ts` keeps every shipped field of both types (append-only guard).
- `packages/vault-api/src/secrets/secrets-agent-access.spec.ts` and `apps/api/test/secrets/identity-document-types.integration.spec.ts`: 422 on opening either type to agents.
- `packages/vault-api/src/mcp/vault-mcp-tools.spec.ts`: neither type is listed, created or found through MCP.
- Review item: a change that opens either type to agents or MCP needs a new ADR that supersedes this one.

## Related issues

- Epic #203: identity documents (Passport, ID Document) and generic AI document scanning.
- #204 scan profile registry; #205 document checks; #206 field model (`keyvalue`, `format`, `mask`); #207 web field model; #208 document image slots; #209 this record and the system types; #210 document extraction API; #211 scan UI; #212 expiry reminders; #213 model choice and on-prem readiness; #214 PDF417 barcode decoding.
