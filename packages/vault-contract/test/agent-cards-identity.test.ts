import { describe, expect, it } from 'vitest';

import {
  AGENT_ACCESS_SETTINGS_DEFAULTS,
  AGENT_CARD_FIELD_MAP,
  AGENT_ERROR_CODES,
  AGENT_IDENTITY_FIELDS,
  AGENT_SCOPES,
  agentActivityQuerySchema,
  agentAmountSchema,
  agentCardFillRequestSchema,
  agentCardGrantRequestCreateSchema,
  agentCardSummarySchema,
  agentCurrencySchema,
  agentIdentityFillRequestSchema,
  amountToMinor,
  cardGrantSchema,
  createCardGrantSchema,
  formatMinorAmount,
  minorToAmount,
  resolveAgentAccessSettings,
} from '../src/agent/index.js';
import { VAULT_ERROR_CODES } from '../src/errors/index.js';
import { SYSTEM_SECRET_TYPES } from '../src/secret-types/index.js';
import { updateAgentAccessSchema } from '../src/secrets/index.js';

const ORIGIN = 'https://shop.example.test';

describe('agent cards and identity contract (ADR-0003)', () => {
  it('adds four scopes with the vault: prefix and no dots', () => {
    expect(AGENT_SCOPES.CARDS_READ).toBe('vault:cards_read');
    expect(AGENT_SCOPES.CARDS_FILL).toBe('vault:cards_fill');
    expect(AGENT_SCOPES.IDENTITY_READ).toBe('vault:identity_read');
    expect(AGENT_SCOPES.IDENTITY_FILL).toBe('vault:identity_fill');
  });

  it('amounts are positive, at most two decimals and capped; currencies are three letters, upper-cased', () => {
    expect(agentAmountSchema.safeParse(42.5).success).toBe(true);
    expect(agentAmountSchema.safeParse(19.99).success).toBe(true);
    expect(agentAmountSchema.safeParse(0).success).toBe(false);
    expect(agentAmountSchema.safeParse(-1).success).toBe(false);
    expect(agentAmountSchema.safeParse(1.005).success).toBe(false);
    expect(agentAmountSchema.safeParse(10_000_000.01).success).toBe(false);
    expect(agentCurrencySchema.parse('usd')).toBe('USD');
    expect(agentCurrencySchema.safeParse('US').success).toBe(false);
    expect(agentCurrencySchema.safeParse('US1').success).toBe(false);
  });

  it('converts amounts to and from hundredths without float drift', () => {
    expect(amountToMinor(19.99)).toBe(1999);
    expect(amountToMinor(0.1 + 0.2)).toBe(30);
    expect(minorToAmount(1999)).toBe(19.99);
    expect(formatMinorAmount(4250)).toBe('42.50');
  });

  it('a card fill needs one known field, an amount, a currency and purpose purchase', () => {
    const ok = { field: 'number', origin: ORIGIN, amount: 25, currency: 'USD', purpose: 'purchase' };
    expect(agentCardFillRequestSchema.safeParse(ok).success).toBe(true);
    expect(agentCardFillRequestSchema.safeParse({ ...ok, frameOrigin: 'https://pay.example.test' }).success).toBe(true);
    expect(agentCardFillRequestSchema.safeParse({ ...ok, field: 'cvv' }).success).toBe(false);
    expect(agentCardFillRequestSchema.safeParse({ ...ok, amount: undefined }).success).toBe(false);
    expect(agentCardFillRequestSchema.safeParse({ ...ok, currency: undefined }).success).toBe(false);
    expect(agentCardFillRequestSchema.safeParse({ ...ok, purpose: 'login' }).success).toBe(false);
    expect(Object.keys(AGENT_CARD_FIELD_MAP).sort()).toEqual(
      ['expMonth', 'expYear', 'holderName', 'number', 'postalCode', 'securityCode'],
    );
  });

  it('a card summary has no key that could carry the number or the code', () => {
    expect(Object.keys(agentCardSummarySchema.shape).sort()).toEqual(
      ['brand', 'expMonth', 'expYear', 'grant', 'id', 'last4', 'name'],
    );
  });

  it('a grant request needs an origin, an amount, a currency and a reason', () => {
    const ok = { origin: ORIGIN, amount: 80, currency: 'EUR', reason: 'Order for Person A' };
    expect(agentCardGrantRequestCreateSchema.safeParse(ok).success).toBe(true);
    expect(agentCardGrantRequestCreateSchema.safeParse({ ...ok, reason: '' }).success).toBe(false);
    expect(agentCardGrantRequestCreateSchema.safeParse({ ...ok, amount: 0 }).success).toBe(false);
  });

  it('a grant needs a merchant, an amount and a currency; the security code is off by default', () => {
    const parsed = createCardGrantSchema.parse({ merchantOrigin: ORIGIN, maxAmount: 100, currency: 'usd' });
    expect(parsed).toMatchObject({ includeSecurityCode: false, frameOrigins: [], currency: 'USD' });
    expect(createCardGrantSchema.safeParse({ merchantOrigin: ORIGIN, currency: 'USD' }).success).toBe(false);
    expect(createCardGrantSchema.safeParse({ merchantOrigin: ORIGIN, maxAmount: 100 }).success).toBe(false);
    expect(
      createCardGrantSchema.safeParse({ merchantOrigin: ORIGIN, maxAmount: 100, currency: 'USD', periodLimit: { period: 'day' } })
        .success,
    ).toBe(false);
    expect(
      createCardGrantSchema.safeParse({
        merchantOrigin: ORIGIN, maxAmount: 100, currency: 'USD', periodLimit: { period: 'month', maxReleases: 3 },
      }).success,
    ).toBe(true);
    expect(Object.keys(cardGrantSchema.shape)).not.toContain('number');
  });

  it('identity fields are the Identity type fields minus notes; a fill takes purpose form', () => {
    const identity = SYSTEM_SECRET_TYPES.find((type) => type.name === 'Identity')!;
    expect(identity.fields.map((f) => f.name).filter((n) => n !== 'notes')).toEqual([...AGENT_IDENTITY_FIELDS]);
    expect(identity.fields.filter((f) => f.sensitive).map((f) => f.name).sort()).toEqual(['date_of_birth', 'id_number']);
    expect(agentIdentityFillRequestSchema.safeParse({ field: 'full_name', origin: ORIGIN, purpose: 'form' }).success).toBe(true);
    expect(agentIdentityFillRequestSchema.safeParse({ field: 'notes', origin: ORIGIN, purpose: 'form' }).success).toBe(false);
    expect(agentIdentityFillRequestSchema.safeParse({ field: 'full_name', origin: ORIGIN, purpose: 'login' }).success).toBe(false);
  });

  it('the Card type gains an optional billing postal code at the end (append-only)', () => {
    const card = SYSTEM_SECRET_TYPES.find((type) => type.name === 'Card')!;
    expect(card.fields.at(-1)).toMatchObject({ name: 'billing_postal_code', required: false, sensitive: false });
  });

  it('the agent-access body takes optional allowed origins', () => {
    expect(updateAgentAccessSchema.safeParse({ agentAccess: 'fill', allowedOrigins: [ORIGIN] }).success).toBe(true);
    expect(updateAgentAccessSchema.safeParse({ agentAccess: 'fill', allowedOrigins: Array(21).fill(ORIGIN) }).success).toBe(false);
  });

  it('both new switches default off, and an older stored row resolves with them off', () => {
    expect(AGENT_ACCESS_SETTINGS_DEFAULTS.cards.enabled).toBe(false);
    expect(AGENT_ACCESS_SETTINGS_DEFAULTS.identity.enabled).toBe(false);
    const old = resolveAgentAccessSettings({ enabled: true, fillPerMinute: 5 });
    expect(old).toMatchObject({ enabled: true, fillPerMinute: 5, cards: { enabled: false }, identity: { enabled: false } });
    expect(resolveAgentAccessSettings({ cards: { enabled: true } }).cards).toEqual({
      enabled: true, fillPerMinute: 10, releasesPerCardPerDay: 5,
    });
    expect(resolveAgentAccessSettings(null)).toEqual(AGENT_ACCESS_SETTINGS_DEFAULTS);
  });

  it('registers every new error code with its status', () => {
    const byCode = new Map(VAULT_ERROR_CODES.map((def) => [def.code, def.status]));
    for (const code of [
      'CARD_ACCESS_DISABLED', 'IDENTITY_ACCESS_DISABLED', 'SECURITY_CODE_NOT_GRANTED', 'CARD_AMOUNT_EXCEEDED',
      'CARD_CURRENCY_MISMATCH', 'CARD_PERIOD_LIMIT_REACHED', 'CARD_DAILY_CAP_REACHED', 'CARD_GRANT_EXPIRED', 'OWNER_SESSION_REQUIRED',
    ] as const) {
      expect(byCode.get(AGENT_ERROR_CODES[code]), code).toBe(403);
    }
    expect(byCode.get(AGENT_ERROR_CODES.CARD_GRANT_EXISTS)).toBe(409);
    expect(byCode.get(AGENT_ERROR_CODES.CARD_GRANT_REQUEST_NOT_PENDING)).toBe(409);
  });

  it('activity accepts the card and identity actions', () => {
    for (const action of ['card_lookup', 'card_fill', 'card_grant_request', 'identity_lookup', 'identity_fill', 'card_grant']) {
      expect(agentActivityQuerySchema.safeParse({ action }).success, action).toBe(true);
    }
  });
});
