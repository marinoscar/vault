import { describe, expect, it } from 'vitest';

import {
  AGENT_ACCESS_SETTINGS_DEFAULTS,
  AGENT_ERROR_CODES,
  agentActivityQuerySchema,
  agentActivityItemSchema,
  agentAccessSettingsSchema,
  agentCreateCredentialRequestSchema,
  agentFillRequestSchema,
  agentGeneratePasswordSchema,
  agentRotatePasswordRequestSchema,
  agentTotpRequestSchema,
} from '../src/agent/index.js';
import { VAULT_ERROR_CODES } from '../src/errors/index.js';

describe('agent contract', () => {
  it('requires a known field and purpose on fill', () => {
    const ok = { field: 'password', origin: 'https://shop.example.test', purpose: 'login' };
    expect(agentFillRequestSchema.safeParse(ok).success).toBe(true);
    expect(agentFillRequestSchema.safeParse({ ...ok, field: 'totp' }).success).toBe(false);
    expect(agentFillRequestSchema.safeParse({ ...ok, field: 'notes' }).success).toBe(false);
    expect(agentFillRequestSchema.safeParse({ ...ok, purpose: undefined }).success).toBe(false);
    expect(agentFillRequestSchema.safeParse({ ...ok, purpose: 'browse' }).success).toBe(false);
    expect(agentTotpRequestSchema.safeParse({ origin: ok.origin, purpose: 'mfa' }).success).toBe(true);
    expect(agentTotpRequestSchema.safeParse({ origin: ok.origin }).success).toBe(false);
  });

  it('generate defaults to 24 characters with symbols and bounds the length to 12..128', () => {
    expect(agentGeneratePasswordSchema.parse({})).toEqual({ length: 24, symbols: true });
    expect(agentGeneratePasswordSchema.safeParse({ length: 11 }).success).toBe(false);
    expect(agentGeneratePasswordSchema.safeParse({ length: 129 }).success).toBe(false);
    expect(agentGeneratePasswordSchema.safeParse({ length: 12, symbols: false }).success).toBe(true);
  });

  it('create and rotate take exactly one of password and generate', () => {
    const base = { name: 'Shop', username: 'person-a', origin: 'https://shop.example.test', purpose: 'signup' };
    expect(agentCreateCredentialRequestSchema.safeParse({ ...base, password: 'pw' }).success).toBe(true);
    expect(agentCreateCredentialRequestSchema.safeParse({ ...base, generate: {} }).success).toBe(true);
    expect(agentCreateCredentialRequestSchema.safeParse(base).success).toBe(false);
    expect(agentCreateCredentialRequestSchema.safeParse({ ...base, password: 'pw', generate: {} }).success).toBe(false);
    const rotate = { origin: base.origin, purpose: 'password_change' };
    expect(agentRotatePasswordRequestSchema.safeParse({ ...rotate, generate: { length: 30 } }).success).toBe(true);
    expect(agentRotatePasswordRequestSchema.safeParse(rotate).success).toBe(false);
    expect(agentRotatePasswordRequestSchema.safeParse({ ...rotate, password: 'a', generate: {} }).success).toBe(false);
  });

  it('a validation message never echoes the submitted password', () => {
    const result = agentCreateCredentialRequestSchema.safeParse({
      name: 'Shop', username: 'u', origin: 'https://a.example.test', purpose: 'login',
      password: 'canary-pw-12345', generate: {},
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain('canary-pw-12345');
  });

  it('the settings defaults are off and satisfy the schema', () => {
    expect(agentAccessSettingsSchema.parse(AGENT_ACCESS_SETTINGS_DEFAULTS)).toEqual({
      enabled: false, lookupPerMinute: 60, fillPerMinute: 30, totpPerMinute: 10, writePerMinute: 10,
    });
  });

  it('the agent error codes are registered with their statuses', () => {
    const byCode = new Map(VAULT_ERROR_CODES.map((def) => [def.code, def.status]));
    expect(byCode.get(AGENT_ERROR_CODES.ORIGIN_MISMATCH)).toBe(403);
    expect(byCode.get(AGENT_ERROR_CODES.AGENT_ACCESS_DISABLED)).toBe(403);
    expect(byCode.get(AGENT_ERROR_CODES.AGENT_CREDENTIAL_REQUIRED)).toBe(403);
    expect(byCode.get(AGENT_ERROR_CODES.RATE_LIMITED)).toBe(429);
  });
});

describe('agent activity (E14.7)', () => {
  it('defaults the query, caps pageSize at 100 and rejects unknown actions and bad dates', () => {
    expect(agentActivityQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(agentActivityQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(agentActivityQuerySchema.safeParse({ action: 'agent_access' }).success).toBe(true);
    expect(agentActivityQuerySchema.safeParse({ action: 'delete' }).success).toBe(false);
    expect(agentActivityQuerySchema.safeParse({ from: 'yesterday' }).success).toBe(false);
  });

  it('an item has no key for a value, and AGENT_ACTIVITY_FORBIDDEN is a registered 403', () => {
    expect(Object.keys(agentActivityItemSchema.shape).sort()).toEqual(
      ['action', 'at', 'clientId', 'clientName', 'credentialKind', 'field', 'id', 'origin', 'purpose', 'reason', 'result', 'secretId', 'secretName'],
    );
    expect(new Map(VAULT_ERROR_CODES.map((d) => [d.code, d.status])).get(AGENT_ERROR_CODES.AGENT_ACTIVITY_FORBIDDEN)).toBe(403);
  });
});
