import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

import { createMockPrismaService, freshTransactionClient, MockPrismaService } from '../../test/mocks/prisma.mock';
import { createMockStorageProvider } from '../../test/mocks/storage-provider.mock';
import { PERMISSIONS } from '../core/roles.constants';
import { VAULT_AUDIT, VAULT_CRYPTO, VAULT_OBJECT_STORE, VAULT_PRISMA, VAULT_SETTINGS } from '../ports';
import { auditOverPrisma } from '../testing';
import { secretListQuerySchema } from '@marinoscar/vault-contract/secrets';
import { updateBrokerAccessSchema } from '@marinoscar/vault-contract/broker';
import { SecretsService } from './secrets.service';
import { SecretsController } from './secrets.controller';

const userId = 'user-aaa';
const secretId = 'secret-111';
const apiKeyType = { id: 't-api', name: 'API Key', isSystem: true, fields: [{ name: 'key', type: 'string', sensitive: true }, { name: 'provider', type: 'string', sensitive: false }] };
const row = (over: Record<string, unknown> = {}) => ({
  id: secretId, name: 'Provider X key', createdById: userId, type: apiKeyType,
  brokerAccess: false, brokerOrigins: [], brokerInjection: null, brokerField: null, brokerAccessChangedAt: null, ...over,
});
const enable = (over: Record<string, unknown> = {}) => updateBrokerAccessSchema.parse({ enabled: true, origins: ['https://api.service-x.example'], ...over });

describe('SecretsService.updateBrokerAccess (#246, ADR-0006)', () => {
  let service: SecretsService;
  let prisma: MockPrismaService;
  const write = [PERMISSIONS.SECRETS_WRITE];

  beforeEach(async () => {
    prisma = createMockPrismaService();
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: unknown) => (typeof arg === 'function' ? arg(freshTransactionClient(prisma)) : arg));
    prisma.auditEvent.create.mockResolvedValue({} as any);
    prisma.secret.update.mockResolvedValue({} as any);
    const module = await Test.createTestingModule({
      providers: [
        SecretsService,
        { provide: VAULT_PRISMA, useValue: prisma },
        { provide: VAULT_CRYPTO, useValue: { encrypt: jest.fn(), decrypt: jest.fn() } },
        { provide: VAULT_OBJECT_STORE, useValue: createMockStorageProvider() },
        { provide: VAULT_SETTINGS, useValue: { getNamespace: jest.fn() } },
        { provide: VAULT_AUDIT, useValue: auditOverPrisma(prisma) },
      ],
    }).compile();
    service = module.get(SecretsService);
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: secretId } as any);
  });

  it('switches it on with normalised origins, stamps the change and audits states, origins and injection kind and name only', async () => {
    prisma.secret.findFirst.mockResolvedValue(row() as any);
    await service.updateBrokerAccess(secretId, enable({ origins: ['https://API.Service-X.example:443/', 'https://api.service-x.example', 'https://b.service-x.example:8443'], injection: { kind: 'header', name: 'X-Api-Key' } }), userId, write);
    expect(prisma.secret.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: secretId, createdById: userId } }));
    const arg = (prisma.secret.update as jest.Mock).mock.calls[0][0];
    expect(arg.data).toMatchObject({
      brokerAccess: true,
      brokerOrigins: ['https://api.service-x.example', 'https://b.service-x.example:8443'],
      brokerInjection: { kind: 'header', name: 'X-Api-Key' },
      brokerField: null,
    });
    expect(arg.data.brokerAccessChangedAt).toBeInstanceOf(Date);
    const audit = (prisma.auditEvent.create as jest.Mock).mock.calls[0][0].data;
    expect(audit.action).toBe('secret.broker_access.update');
    expect(audit.meta).toEqual({
      secretId, from: false, to: true, origins: ['https://api.service-x.example', 'https://b.service-x.example:8443'],
      injection: { kind: 'header', name: 'X-Api-Key' }, field: null,
    });
  });

  it('does nothing (no write, no audit) when nothing changes, and writes when only the origins change', async () => {
    const same = row({ brokerAccess: true, brokerOrigins: ['https://api.service-x.example'], brokerInjection: { kind: 'header', name: 'X-Api-Key' } });
    prisma.secret.findFirst.mockResolvedValue(same as any);
    await service.updateBrokerAccess(secretId, enable({ injection: { kind: 'header', name: 'X-Api-Key' } }), userId, write);
    expect(prisma.secret.update).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
    await service.updateBrokerAccess(secretId, enable({ origins: ['https://other.service-x.example'], injection: { kind: 'header', name: 'X-Api-Key' } }), userId, write);
    expect(prisma.secret.update).toHaveBeenCalledTimes(1);
  });

  it('omitted origins, injection and field keep their stored values', async () => {
    prisma.secret.findFirst.mockResolvedValue(row({ brokerAccess: false, brokerOrigins: ['https://api.service-x.example'], brokerInjection: { kind: 'query', name: 'k' } }) as any);
    await service.updateBrokerAccess(secretId, updateBrokerAccessSchema.parse({ enabled: true }), userId, write);
    expect((prisma.secret.update as jest.Mock).mock.calls[0][0].data).toMatchObject({ brokerOrigins: ['https://api.service-x.example'], brokerInjection: { kind: 'query', name: 'k' } });
  });

  it('turning it OFF is always allowed, even for a type the broker no longer supports, and keeps the configuration', async () => {
    prisma.secret.findFirst.mockResolvedValue(row({ brokerAccess: true, brokerOrigins: ['https://api.service-x.example'], type: { name: 'Card', isSystem: true, fields: [] } }) as any);
    await service.updateBrokerAccess(secretId, updateBrokerAccessSchema.parse({ enabled: false }), userId, write);
    const data = (prisma.secret.update as jest.Mock).mock.calls[0][0].data;
    expect(data.brokerAccess).toBe(false);
    expect(data).not.toHaveProperty('brokerOrigins');
    expect((prisma.auditEvent.create as jest.Mock).mock.calls[0][0].data.meta).toMatchObject({ from: true, to: false });
  });

  it('is owner only: a missing or foreign secret is 404, even with secrets:write_any', async () => {
    prisma.secret.findFirst.mockResolvedValue(null);
    const error = await service.updateBrokerAccess(secretId, enable(), 'admin-1', [PERMISSIONS.SECRETS_WRITE, 'secrets:write_any']).catch((e) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect(prisma.secret.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: secretId, createdById: 'admin-1' } }));
    expect(prisma.secret.update).not.toHaveBeenCalled();
  });

  it.each(['Credential', 'Card', 'Identity', 'Passport', 'ID Document', 'Note'])('answers 422 BROKER_UNSUPPORTED_TYPE for the system %s', async (name) => {
    prisma.secret.findFirst.mockResolvedValue(row({ type: { name, isSystem: true, fields: [{ name: 'password', type: 'string', sensitive: true }] } }) as any);
    const error = await service.updateBrokerAccess(secretId, enable(), userId, write).catch((e) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error.getResponse().code).toBe('BROKER_UNSUPPORTED_TYPE');
    expect(prisma.secret.update).not.toHaveBeenCalled();
  });

  it('allows API Key, Token, Service Key and a custom type with one sensitive field; a custom type with two needs a named field', async () => {
    for (const t of [
      apiKeyType,
      { name: 'Token', isSystem: true, fields: [{ name: 'token', type: 'string', sensitive: true }] },
      { name: 'Service Key', isSystem: true, fields: [{ name: 'key', type: 'string', sensitive: true }] },
      { name: 'Svc', isSystem: false, fields: [{ name: 'secret_a', type: 'string', sensitive: true }] },
    ]) {
      prisma.secret.update.mockClear();
      prisma.secret.findFirst.mockResolvedValue(row({ type: t }) as any);
      await service.updateBrokerAccess(secretId, enable(), userId, write);
      expect(prisma.secret.update).toHaveBeenCalledTimes(1);
    }
    const two = { name: 'Svc2', isSystem: false, fields: [{ name: 'a', type: 'string', sensitive: true }, { name: 'b', type: 'string', sensitive: true }] };
    prisma.secret.findFirst.mockResolvedValue(row({ type: two }) as any);
    expect((await service.updateBrokerAccess(secretId, enable(), userId, write).catch((e) => e)).getResponse().code).toBe('BROKER_FIELD_INVALID');
    expect((await service.updateBrokerAccess(secretId, enable({ field: 'provider' }), userId, write).catch((e) => e)).getResponse().code).toBe('BROKER_FIELD_INVALID');
    prisma.secret.update.mockClear();
    await service.updateBrokerAccess(secretId, enable({ field: 'b' }), userId, write);
    expect((prisma.secret.update as jest.Mock).mock.calls[0][0].data.brokerField).toBe('b');
  });

  it('enabling needs an origin: 422 BROKER_ORIGINS_REQUIRED', async () => {
    prisma.secret.findFirst.mockResolvedValue(row() as any);
    for (const body of [updateBrokerAccessSchema.parse({ enabled: true }), updateBrokerAccessSchema.parse({ enabled: true, origins: [] })]) {
      const error = await service.updateBrokerAccess(secretId, body, userId, write).catch((e) => e);
      expect(error.getResponse().code).toBe('BROKER_ORIGINS_REQUIRED');
    }
    expect(prisma.secret.update).not.toHaveBeenCalled();
  });

  it.each([
    'http://api.service-x.example', 'https://api.service-x.example/v1', 'https://user@api.service-x.example', 'https://localhost',
    'https://printer.local', 'https://db.internal', 'https://127.0.0.1', 'https://10.1.2.3', 'https://169.254.169.254', 'https://[::1]', '*.service-x.example', 'not a url',
  ])('answers 422 BROKER_ORIGIN_INVALID for %s', async (origin) => {
    prisma.secret.findFirst.mockResolvedValue(row() as any);
    const error = await service.updateBrokerAccess(secretId, enable({ origins: ['https://ok.service-x.example', origin] }), userId, write).catch((e) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error.getResponse().code).toBe('BROKER_ORIGIN_INVALID');
    expect(prisma.secret.update).not.toHaveBeenCalled();
  });

  it('a stored injection that no longer validates answers 422 BROKER_INJECTION_INVALID', async () => {
    prisma.secret.findFirst.mockResolvedValue(row({ brokerInjection: { kind: 'nonsense' } }) as any);
    const error = await service.updateBrokerAccess(secretId, enable({ origins: ['https://ok.service-x.example'] }), userId, write).catch((e) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error.getResponse().code).toBe('BROKER_INJECTION_INVALID');
    expect(prisma.secret.update).not.toHaveBeenCalled();
  });

  it('the list filter parses brokerAccess=true|false and findAll passes it to the query', async () => {
    expect(secretListQuerySchema.parse({}).brokerAccess).toBeUndefined();
    expect(secretListQuerySchema.parse({ brokerAccess: 'true' }).brokerAccess).toBe(true);
    expect(secretListQuerySchema.parse({ brokerAccess: 'false' }).brokerAccess).toBe(false);
    expect(secretListQuerySchema.safeParse({ brokerAccess: 'maybe' }).success).toBe(false);
    prisma.secret.findMany.mockResolvedValue([]);
    prisma.secret.count.mockResolvedValue(0);
    await service.findAll(secretListQuerySchema.parse({ brokerAccess: 'true' }) as any, userId, write);
    expect((prisma.secret.findMany as jest.Mock).mock.calls[0][0].where).toMatchObject({ createdById: userId, brokerAccess: true });
  });
});

describe('SecretsController broker-access route (#246)', () => {
  const user = { id: userId, permissions: [PERMISSIONS.SECRETS_WRITE] } as any;
  const svc = { updateBrokerAccess: jest.fn().mockResolvedValue({ id: secretId, brokerAccess: true }) };
  const controller = new SecretsController(svc as any, {} as any, {} as any, {} as any);
  beforeEach(() => svc.updateBrokerAccess.mockClear());

  it('refuses an OAuth oat_ credential with 403 and never reaches the service', async () => {
    const oauth = { kind: 'oauth', tokenId: 't', grantId: 'g', clientId: 'c', resourceId: 'mcp', scopes: ['vault:mcp_write'] } as any;
    await expect(controller.updateBrokerAccess(secretId, enable() as any, user, oauth)).rejects.toThrow(ForbiddenException);
    expect(svc.updateBrokerAccess).not.toHaveBeenCalled();
  });

  it('serves a session and a personal access token', async () => {
    for (const credential of [{ kind: 'jwt' }, { kind: 'pat', tokenId: 'p' }] as any[]) {
      const result = await controller.updateBrokerAccess(secretId, enable() as any, user, credential);
      expect(result).toEqual({ data: { id: secretId, brokerAccess: true } });
    }
    expect(svc.updateBrokerAccess).toHaveBeenCalledWith(secretId, expect.objectContaining({ enabled: true }), userId, user.permissions);
  });
});
