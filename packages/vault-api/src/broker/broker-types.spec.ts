import { resolveBrokerField } from './broker-types';

const f = (name: string, sensitive: boolean, type = 'string') => ({ name, label: name, type, sensitive });

describe('resolveBrokerField', () => {
  it('uses the one sensitive field of API Key, Token and Service Key', () => {
    expect(resolveBrokerField({ name: 'API Key', isSystem: true, fields: [f('key', true), f('provider', false), f('notes', false)] })).toEqual({ ok: true, field: 'key' });
    expect(resolveBrokerField({ name: 'Token', isSystem: true, fields: [f('token', true), f('notes', false)] })).toEqual({ ok: true, field: 'token' });
    expect(resolveBrokerField({ name: 'Service Key', isSystem: true, fields: [f('service', false), f('key_name', false), f('key', true)] })).toEqual({ ok: true, field: 'key' });
  });

  it.each(['Credential', 'Card', 'Identity', 'Passport', 'ID Document', 'Note'])('refuses the system type %s', (name) => {
    const result = resolveBrokerField({ name, isSystem: true, fields: [f('password', true)] });
    expect(result).toMatchObject({ ok: false, code: 'BROKER_UNSUPPORTED_TYPE' });
  });

  it('refuses a type with a cvv-like field or no sensitive field', () => {
    expect(resolveBrokerField({ name: 'Gift Card', fields: [f('code', true), f('cvv', true)] })).toMatchObject({ ok: false, code: 'BROKER_UNSUPPORTED_TYPE' });
    expect(resolveBrokerField({ name: 'Plain', fields: [f('a', false)] })).toMatchObject({ ok: false, code: 'BROKER_UNSUPPORTED_TYPE' });
    expect(resolveBrokerField({ name: 'Kv', fields: [f('map', true, 'keyvalue')] })).toMatchObject({ ok: false, code: 'BROKER_UNSUPPORTED_TYPE' });
  });

  it('a custom type with one sensitive field works; with several the caller must name one that is sensitive', () => {
    expect(resolveBrokerField({ name: 'Svc', fields: [f('secret_a', true), f('region', false)] })).toEqual({ ok: true, field: 'secret_a' });
    const two = { name: 'Svc2', fields: [f('a', true), f('b', true), f('c', false)] };
    expect(resolveBrokerField(two)).toMatchObject({ ok: false, code: 'BROKER_FIELD_INVALID' });
    expect(resolveBrokerField(two, 'b')).toEqual({ ok: true, field: 'b' });
    expect(resolveBrokerField(two, 'c')).toMatchObject({ ok: false, code: 'BROKER_FIELD_INVALID' });
    expect(resolveBrokerField(two, 'zzz')).toMatchObject({ ok: false, code: 'BROKER_FIELD_INVALID' });
  });
});
