# ADR-0003: Agent release of cards and identity

- Status: Accepted
- Date: 2026-11-19
- Related issues: epic #191; #195 (this record and its implementation); #194 (a second host that embeds the packages); builds on [ADR-0002](0002-agent-access.md)

## Context

[ADR-0002](0002-agent-access.md) lets an agent runtime fill a `Credential` login, one field at a time, on one of the login's exact origins. Runtimes that complete a checkout or fill an identity form have no supported way to get a card number or an identity field, so the person types them each time or keeps them somewhere less careful.

A card is harder than a login. A password is useless away from its own site, so binding it to the exact origin is enough. **A card works on any site.** A runtime steered by a hostile page can ask for it anywhere, and a release cannot be undone. A card also carries an amount: the owner cares less about *where* it is typed than about *how much* and *how often*. Identity fields (a legal name, a date of birth, a government id number, an address) are a mix: an address is filled into many forms, an id number into very few.

The question is how to release these values to runtimes, and to in-process hosts that embed the packages (#194), without making a card a universal key and without trusting the runtime's own rules.

## Decision

1. **Opened per item, as for logins.** `secrets.agent_access = fill` now also applies to the system `Card` type and to a new system type `Identity`. Default `none`; only the owner, with a browser session, opens or closes an item. Custom types stay closed.
2. **The `Identity` system type** has the fields `full_name`, `date_of_birth`, `id_type`, `id_number`, `id_issuing_country`, `address_line1`, `address_line2`, `city`, `region`, `postal_code`, `country`, `phone`, `email` and `notes`. `date_of_birth` and `id_number` are `sensitive`. `notes` is never released. The `Card` type gains the optional field `billing_postal_code` (append-only rule).
3. **A card is released only under a merchant grant** (`agent_card_grants`), created by its owner with a browser session (`credential.kind = jwt`); an `oat_` or `pat_` token is refused with `403 OWNER_SESSION_REQUIRED` on every grant and request write. A grant names:
   - the merchant origin (normalized like a login origin) and its **registrable domain** (`merchant_site`), which is what a request is matched on, because checkout pages move between subdomains;
   - an optional list of exact **payment frame origins** the owner accepts for that merchant;
   - a required **maximum amount and currency** (ISO 4217, three letters); amounts are decimals with at most two places and are stored in hundredths (`*_minor`), at most 10,000,000.00;
   - an optional **period limit**: per UTC calendar `day` or `month`, at most N releases and/or a total amount;
   - an optional **expiry**, and **include security code** (default off).
   There is no "any merchant" grant. A card has at most one live grant per merchant site (`409 CARD_GRANT_EXISTS`); to change one the owner revokes it and creates another. A revoked grant is kept for the record.
4. **Grant requests.** `POST /api/agent/v1/cards/{id}/grant-requests { origin, amount, currency, reason }` creates a pending request (`agent_card_grant_requests`) and notifies the owner (bell and email). It returns `{ id, status }` and never card data. A second request for the same card and merchant site while one is pending returns the pending one. The owner approves (exactly the requested grant: that merchant origin, that amount as the maximum, that currency, no period limit, no expiry, no security code) or declines. Requests follow the card's 404 rule: a card that is not opened is a 404.
5. **Routes and scopes.** New permissions `agent_cards:read`, `agent_cards:fill`, `agent_identity:read`, `agent_identity:fill`, bundled in the new scopes `vault:cards_read`, `vault:cards_fill`, `vault:identity_read`, `vault:identity_fill` of the `agent` resource. A token without the scope gets `403 insufficient_scope`; `vault:items_*` reaches no card or identity route.

   | Route | Scope | Returns |
   |---|---|---|
   | `GET /cards?origin=` | `vault:cards_read` | opened cards with a live grant for this merchant site: `id`, `name`, `brand`, `last4`, `expMonth`, `expYear`, `grant { maxAmount, currency, includesSecurityCode, expiresAt }` |
   | `POST /cards/{id}/fill` | `vault:cards_fill` | `{ value }` of ONE of `number`, `expMonth`, `expYear`, `holderName`, `securityCode`, `postalCode` |
   | `POST /cards/{id}/grant-requests` | `vault:cards_fill` | `{ id, status }` |
   | `GET /identity?origin=` | `vault:identity_read` | opened identity items and, per field, its label, whether it is sensitive and whether it is fillable on this origin |
   | `POST /identity/{id}/fill` | `vault:identity_fill` | `{ value }` of ONE field |

6. **The rules of a card fill**, checked in this order after the pipeline of ADR-0002 (credential kind, kill switches, rate limit):
   1. the card is missing, foreign, not opened, not a system `Card`, or has **no live grant at all**: one identical `404`;
   2. `origin` must be a valid https origin (`400`); its merchant site must have a non-revoked grant: if the only one has expired, `403 CARD_GRANT_EXPIRED`; if there is none for this site (the card is granted elsewhere), `403 ORIGIN_MISMATCH`;
   3. a `frameOrigin`, when sent, must be exactly on the grant's list, else `403 ORIGIN_MISMATCH`;
   4. `currency` must equal the grant's (`403 CARD_CURRENCY_MISMATCH`) and `amount` must not exceed its maximum (`403 CARD_AMOUNT_EXCEEDED`);
   5. `securityCode` needs the grant's flag (`403 SECURITY_CODE_NOT_GRANTED`);
   6. a `number` fill is a **release**: it counts against the grant's period limit (`403 CARD_PERIOD_LIMIT_REACHED`) and the per-card daily cap `agentAccess.cards.releasesPerCardPerDay` across all grants (`403 CARD_DAILY_CAP_REACHED`), both counted per UTC calendar day or month. The check and the insert of the release row (`agent_card_releases`, amount and currency) run in one transaction holding a row lock on the card, so concurrent fills cannot both pass the last slot.
   The other fields are not releases (a checkout needs several of them), but each is still checked against rules 1 to 5 and audited with its amount.
7. **The rules of an identity fill.** One field per call (`purpose: "form"`). The item must be opened (`404` otherwise). A non-sensitive field is released to any valid https origin. A `sensitive` field is released only to an origin exactly on that item's **allowed origins** (`secrets.agent_origins`, set only by the owner on the agent-access route with a browser session), else `403 ORIGIN_MISMATCH`.
8. **Two more kill switches.** `agentAccess.cards.enabled` and `agentAccess.identity.enabled`, both default **off** and separate from `agentAccess.enabled`. A card route answers `403 CARD_ACCESS_DISABLED` while the card switch is off; an identity route `403 IDENTITY_ACCESS_DISABLED`; and every one of them `403 AGENT_ACCESS_DISABLED` while the agent switch is off.
9. **Rate limits.** Own buckets with stricter defaults than `fill` (30): `card_fill` (`agentAccess.cards.fillPerMinute`, default 10) and `identity_fill` (`agentAccess.identity.fillPerMinute`, default 20). Lookups use the `lookup` bucket, grant requests the `write` bucket. Plus the per-card daily cap of releases (default 5).
10. **Nothing of a value leaves.** `Cache-Control: no-store` on every response; one field per response; no value, number, last four or code in a log, a span, a metric label, an audit row, a notification or an error body. Audit rows name the client, the item, the merchant origin, the frame origin, the field, the amount and the currency.
11. **Owner visibility.** Every call is in Agent activity with the client, the item, the merchant, the field and the amount. The owner is notified (bell and email) of a grant request, of the **first release** of a card under a grant, and of a **declined** card fill (amount, currency, period, daily cap, expired grant, wrong merchant or frame, security code not granted), at most once per card, reason and merchant per hour. The owner can close a card, revoke a grant, or the administrator can switch card release off.
12. **One implementation, an in-process port.** `@marinoscar/vault-api/agent` exports `AgentReleasePort` (`lookup`, `fill`, `totp`, `cardsLookup`, `cardFill`, `identityLookup`, `identityFill`), its token `AGENT_RELEASE_PORT` and its implementation `AgentReleaseService`. Each method takes `{ userId, clientLabel, origin, ... }`; an embedded host calls it without HTTP or OAuth. The HTTP controllers call the same service, passing the request's credential; a call with a credential must carry an `oat_` or `pat_` token, a call without one is an in-process call identified by `clientLabel` (audited as `credential: embedded`). Kill switches, rate limits, the rules above, audit and notifications are the same on both paths.

## Consequences

- **A release is not a payment authorisation.** Vault cannot see the charge. The amount is the runtime's statement, checked against the owner's limit and recorded; a runtime that lies about the amount is bounded by the merchant binding, the period limit, the daily cap and the trail, not stopped. Virtual cards with their own limits remain the strongest control, and the provider guide recommends them.
- **Registrable-domain matching is wider than a login's exact origin.** A compromised subdomain of a granted merchant can receive the card. The owner chooses the merchant, and the frame list narrows embedded payment frames; the trade-off is documented in the threat model.
- **Merchant sites and frame origins are plaintext metadata**, like a login's origins: a database reader learns where a user allowed a card, never a number.
- **Splitting a purchase** into many small amounts is bounded by the period limit (count and total), the daily cap and rate limits, since every purchase needs a `number` release.
- **Rate limits and the decline-notification throttle are in process memory**, as in ADR-0002; a second API instance needs a shared limiter.
- **Grants are not in backups or exports.** A restored deployment starts with every card's grants empty; owners re-create them. Secret export zips carry secret values only.
- **Identity is not origin-bound for non-sensitive fields.** An address fills into any form once the item is opened; an owner who disagrees keeps the item closed.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Treat a card like a login with a list of origins | Does not model amounts, and invites a long list of merchants nobody reviews. |
| Release the whole card in one call | Violates "one field per call" and makes a single log line a full card. |
| Leave cards out; recommend virtual cards only | Still recommended, but the owner then stores the virtual card's number somewhere and the same question returns. |
| Exact-origin grants | Checkouts move between `shop.`, `checkout.` and `pay.` of the same merchant; owners would add many grants or give up. The frame list stays exact. |
| Count every card field as a release | A single checkout would use three to five releases and make the limits meaningless. |
| One kill switch for everything | Cards are the highest-risk item and identity the next; an operator may want logins without them. |
| A grant writable by an agent token after the owner's consent screen | Consent screens are clicked through; the owner's own session in Vault is the only place a grant is made or widened. |

## Enforcement

- `packages/vault-api/src/agent/agent-release.spec.ts` runs one table of cases twice: through `AgentReleasePort` (in process) and through the HTTP controllers. It covers listing and filling only with an opened card and a live grant, every refusal code in rule 6, identity origin rules, identical 404s, both kill switches, rate limits and the daily cap.
- `apps/api/test/agent/agent-cards.db.spec.ts` drives a real OAuth flow on Postgres: scopes (`insufficient_scope`), every grant write refused for `oat_` and `pat_`, grant requests (pending, notified, no card data, approval creates exactly the requested grant), and a canary scan of every response, audit row and log line for a card number, a security code and an identity number.
- `packages/vault-contract/test/agent.test.ts` pins the schemas, scopes, error codes and settings defaults (both new switches off).
- Review item for any pull request touching `packages/vault-api/src/agent/`: no route returns more than one card or identity field, and no grant write accepts a token.

## Related issues

Epic #191; #195 (this record); #194 (embedded host, the port's consumer); #196. Builds on epic #172 and [ADR-0002](0002-agent-access.md).
