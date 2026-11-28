import { describe, expect, it } from 'vitest';

import { resolveAgentAccessSettings } from '../src/agent/index.js';
import {
  BROKER_ERROR_CODES,
  brokerBaseUrl,
  brokerInjectionSchema,
  createBrokerTokenSchema,
  isBrokerTokenShape,
  isForbiddenInjectionHeader,
  updateBrokerAccessSchema,
} from '../src/broker/index.js';
import { VAULT_ERROR_CODES } from '../src/errors/index.js';

describe('broker injection schema', () => {
  it('accepts a header with an allowed prefix and a query parameter', () => {
    expect(brokerInjectionSchema.parse({ kind: 'header', name: 'X-Api-Key' })).toEqual({ kind: 'header', name: 'X-Api-Key' });
    expect(brokerInjectionSchema.parse({ kind: 'header', name: 'Authorization', prefix: 'Bearer' }).kind).toBe('header');
    for (const prefix of ['', 'Bearer', 'Token', 'Basic', 'Bot', 'ApiKey']) {
      expect(brokerInjectionSchema.safeParse({ kind: 'header', name: 'Authorization', prefix }).success, prefix).toBe(true);
    }
    expect(brokerInjectionSchema.parse({ kind: 'query', name: 'api_key' })).toEqual({ kind: 'query', name: 'api_key' });
  });

  it.each([
    'host', 'Host', 'cookie', 'Set-Cookie', 'content-length', 'Transfer-Encoding', 'connection', 'upgrade',
    'proxy-authorization', 'Proxy-Anything', 'forwarded', 'x-forwarded-for', 'X-Forwarded-Host', 'x-real-ip', 'x-vault-broker', 'X-Vault-Anything',
  ])('refuses the header name %s', (name) => {
    expect(isForbiddenInjectionHeader(name)).toBe(true);
    expect(brokerInjectionSchema.safeParse({ kind: 'header', name }).success).toBe(false);
  });

  it('refuses a malformed name, an unknown prefix and an unknown kind', () => {
    expect(brokerInjectionSchema.safeParse({ kind: 'header', name: 'Bad Name' }).success).toBe(false);
    expect(brokerInjectionSchema.safeParse({ kind: 'header', name: 'a'.repeat(65) }).success).toBe(false);
    expect(brokerInjectionSchema.safeParse({ kind: 'header', name: 'X\r\nEvil' }).success).toBe(false);
    expect(brokerInjectionSchema.safeParse({ kind: 'header', name: 'Authorization', prefix: 'Digest' }).success).toBe(false);
    expect(brokerInjectionSchema.safeParse({ kind: 'query', name: 'a b' }).success).toBe(false);
    expect(brokerInjectionSchema.safeParse({ kind: 'body', name: 'key' }).success).toBe(false);
  });
});

describe('broker opt-in and token bodies', () => {
  it('bounds the origins to 20 and requires a boolean', () => {
    expect(updateBrokerAccessSchema.safeParse({ enabled: true, origins: ['https://api.service-x.example'] }).success).toBe(true);
    expect(updateBrokerAccessSchema.safeParse({ enabled: false }).success).toBe(true);
    expect(updateBrokerAccessSchema.safeParse({ enabled: 'yes' }).success).toBe(false);
    const many = Array.from({ length: 21 }, (_, i) => `https://h${i}.example`);
    expect(updateBrokerAccessSchema.safeParse({ enabled: true, origins: many }).success).toBe(false);
  });

  it('a token needs a name, expires in 1 to 3650 days (default 90) and restricts to uuids', () => {
    expect(createBrokerTokenSchema.parse({ name: 'Sandbox A' }).expiresInDays).toBe(90);
    expect(createBrokerTokenSchema.safeParse({ name: 'x', expiresInDays: 0 }).success).toBe(false);
    expect(createBrokerTokenSchema.safeParse({ name: 'x', expiresInDays: 3651 }).success).toBe(false);
    expect(createBrokerTokenSchema.safeParse({ name: 'x', expiresInDays: 3650 }).success).toBe(true);
    expect(createBrokerTokenSchema.safeParse({ name: 'x', expiresInDays: null }).success).toBe(false);
    expect(createBrokerTokenSchema.safeParse({ name: '' }).success).toBe(false);
    expect(createBrokerTokenSchema.safeParse({ name: 'x', secretIds: ['not-a-uuid'] }).success).toBe(false);
  });

  it('knows the shape of a token and builds the base URL', () => {
    expect(isBrokerTokenShape(`vbk_${'a'.repeat(40)}`)).toBe(true);
    expect(isBrokerTokenShape(`vbk_${'a'.repeat(39)}`)).toBe(false);
    expect(isBrokerTokenShape(`pat_${'a'.repeat(40)}`)).toBe(false);
    expect(brokerBaseUrl('https://vault.example.test/api/', 'abc', 'https://api.service-x.example:8443')).toBe(
      'https://vault.example.test/api/broker/v1/abc/api.service-x.example:8443',
    );
  });
});

describe('broker error codes and settings', () => {
  it('registers every broker code with the status it is thrown with', () => {
    const byCode = new Map(VAULT_ERROR_CODES.map((d) => [d.code, d.status]));
    const expected: Record<string, number> = {
      BROKER_DISABLED: 403, BROKER_CREDENTIAL_REFUSED: 403, BROKER_ORIGIN_MISMATCH: 403, BROKER_DESTINATION_BLOCKED: 403,
      BROKER_REQUEST_TOO_LARGE: 413, BROKER_RESPONSE_TOO_LARGE: 502, BROKER_UPSTREAM_TIMEOUT: 504, BROKER_UPSTREAM_ERROR: 502,
      BROKER_KEY_ECHO: 502, BROKER_KEY_MISSING: 422, BROKER_UNSUPPORTED_TYPE: 422, BROKER_ORIGINS_REQUIRED: 422,
      BROKER_ORIGIN_INVALID: 422, BROKER_FIELD_INVALID: 422, BROKER_TOKEN_SECRET_INVALID: 422,
    };
    expect(Object.values(BROKER_ERROR_CODES).sort()).toEqual(Object.keys(expected).sort());
    for (const [code, status] of Object.entries(expected)) expect(byCode.get(code), code).toBe(status);
  });

  it('the broker settings default to off and merge over a stored row that has none', () => {
    const defaults = resolveAgentAccessSettings(undefined).broker!;
    expect(defaults).toEqual({ enabled: false, forwardsPerMinute: 60, maxRequestBytes: 10485760, maxResponseBytes: 26214400, timeoutMs: 30000 });
    expect(resolveAgentAccessSettings({ enabled: true }).broker!.enabled).toBe(false);
    expect(resolveAgentAccessSettings({ broker: { enabled: true, forwardsPerMinute: 5 } }).broker).toEqual({ ...defaults, enabled: true, forwardsPerMinute: 5 });
  });
});
