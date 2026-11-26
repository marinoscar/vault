import { describe, expect, it } from 'vitest';

import {
  AGENT_API_BASE_PATH,
  AGENT_AUDIT_ACTIONS,
  AGENT_CONTRACT_FEATURES,
  AGENT_CONTRACT_VERSION,
  AGENT_ERROR_CODES,
  AGENT_SCOPES,
  AGENT_SERVICE_KEY_PER_MINUTE,
  AGENT_SERVICE_KEY_PURPOSE,
  AGENT_SERVICE_KEYS_PATH,
  agentActivityActionSchema,
  agentContractInfoFor,
  agentServiceKeyParamsSchema,
  agentServiceKeyResponseSchema,
} from '../src/agent/index.js';
import { VAULT_ERROR_CODES } from '../src/errors/index.js';
import {
  normalizeServiceKeyId,
  SERVICE_KEY_NAME_FIELD,
  SERVICE_KEY_SERVICE_FIELD,
  SERVICE_KEY_TYPE_NAME,
  SERVICE_KEY_VALUE_FIELD,
  SYSTEM_SECRET_TYPES,
  secretTypeFieldsSchema,
} from '../src/secret-types/index.js';

describe('the Service Key system type (issue #241)', () => {
  const type = SYSTEM_SECRET_TYPES.find((t) => t.name === SERVICE_KEY_TYPE_NAME)!;

  it('is appended last, with one sensitive value, a service and a key name, and no website', () => {
    expect(SYSTEM_SECRET_TYPES.at(-1)?.name).toBe('Service Key');
    expect(type.fields.map((f) => f.name)).toEqual([SERVICE_KEY_SERVICE_FIELD, SERVICE_KEY_NAME_FIELD, SERVICE_KEY_VALUE_FIELD, 'notes']);
    expect(type.fields.filter((f) => f.sensitive).map((f) => f.name)).toEqual(['key']);
    expect(type.fields.filter((f) => f.required).map((f) => f.name)).toEqual(['service', 'key_name', 'key']);
    expect(type.fields.some((f) => /url|origin/.test(f.name))).toBe(false);
    expect(type.allowAttachments).toBe(false);
    expect(secretTypeFieldsSchema.safeParse(type.fields).success).toBe(true);
  });

  it('normalizes a service or key name (trim, lower case) and refuses anything else', () => {
    expect(normalizeServiceKeyId('  Web_Search ')).toBe('web_search');
    expect(normalizeServiceKeyId('provider-a')).toBe('provider-a');
    expect(normalizeServiceKeyId('9lives')).toBe('9lives');
    for (const bad of ['', ' ', '_lead', 'has space', 'dot.ted', 'slash/ed', 'x'.repeat(65), 42, null, undefined]) {
      expect(normalizeServiceKeyId(bad), String(bad)).toBeNull();
    }
    expect(normalizeServiceKeyId('x'.repeat(64))).toBe('x'.repeat(64));
  });
});

describe('the service-key route of the agent contract (1.4)', () => {
  it('names a route, a scope, an error code, an audit action and an activity action of its own', () => {
    expect(AGENT_CONTRACT_VERSION).toBe('1.4');
    expect(`${AGENT_API_BASE_PATH}${AGENT_SERVICE_KEYS_PATH}`).toBe('/api/agent/v1/service-keys/:service/:name');
    expect(AGENT_SCOPES.SERVICE_KEYS_READ).toBe('vault:service_keys_read');
    expect(AGENT_ERROR_CODES.SERVICE_KEY_AMBIGUOUS).toBe('SERVICE_KEY_AMBIGUOUS');
    const statuses = new Map(VAULT_ERROR_CODES.map((d) => [d.code, d.status]));
    expect(statuses.get('SERVICE_KEY_AMBIGUOUS')).toBe(409);
    expect(statuses.get('SERVICE_KEY_EXISTS')).toBe(409);
    expect(AGENT_AUDIT_ACTIONS.SERVICE_KEY_READ).toBe('agent.service_key.read');
    expect(agentActivityActionSchema.options).toContain('service_key');
    expect(AGENT_SERVICE_KEY_PER_MINUTE).toBe(120);
    expect(AGENT_SERVICE_KEY_PURPOSE).toBe('service_call');
  });

  it('parses the path ids like the stored ones, and answers one value', () => {
    expect(agentServiceKeyParamsSchema.parse({ service: 'Web_Search', name: ' provider_a ' })).toEqual({ service: 'web_search', name: 'provider_a' });
    expect(agentServiceKeyParamsSchema.safeParse({ service: 'web search', name: 'a' }).success).toBe(false);
    expect(agentServiceKeyParamsSchema.safeParse({ service: 'web_search' }).success).toBe(false);
    expect(Object.keys(agentServiceKeyResponseSchema.shape.data.shape)).toEqual(['value']);
  });

  it('reports service_keys in whoami whatever the card and identity switches', () => {
    const off = agentContractInfoFor({ cards: { enabled: false }, identity: { enabled: false } });
    expect(off.features).toEqual(['logins', 'totp', 'save_login', 'service_keys']);
    const on = agentContractInfoFor({ cards: { enabled: true }, identity: { enabled: true } });
    expect(on.features).toEqual(['logins', 'totp', 'save_login', AGENT_CONTRACT_FEATURES.SERVICE_KEYS, 'cards', 'identity']);
  });
});
