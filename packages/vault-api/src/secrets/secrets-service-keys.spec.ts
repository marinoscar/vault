// Service Key secrets (issue #241): ids normalized on write, one key per (owner, service, key name),
// opening to agents allowed, and the opened-key lookup the agent release uses. Invented values only.
import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { SYSTEM_SECRET_TYPES } from '@marinoscar/vault-contract/secret-types';

import { createMockPrismaService, freshTransactionClient, MockPrismaService } from '../../test/mocks/prisma.mock';
import { createMockStorageProvider } from '../../test/mocks/storage-provider.mock';
import { VAULT_AUDIT, VAULT_CRYPTO, VAULT_OBJECT_STORE, VAULT_PRISMA, VAULT_SETTINGS } from '../ports';
import { auditOverPrisma, TestCrypto } from '../testing';
import { isAgentOpenableType, normalizeServiceKeyData, SecretsService } from './secrets.service';

const USER = 'user-aaa';
const CANARY = 'sk-canary-Lm40?';
const serviceKeyType = {
  id: 't-sk',
  name: 'Service Key',
  isSystem: true,
  fields: SYSTEM_SECRET_TYPES.find((t) => t.name === 'Service Key')!.fields,
};

describe('Service Key secrets', () => {
  let service: SecretsService;
  let prisma: MockPrismaService;
  const crypto = new TestCrypto();
  const encrypted = (data: unknown) => {
    const e = crypto.encrypt(JSON.stringify(data));
    return { encryptedData: e.ciphertext, iv: e.iv, authTag: e.authTag };
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: unknown) =>
      typeof arg === 'function' ? arg(freshTransactionClient(prisma)) : arg,
    );
    prisma.auditEvent.create.mockResolvedValue({} as any);
    const module = await Test.createTestingModule({
      providers: [
        SecretsService,
        { provide: VAULT_PRISMA, useValue: prisma },
        { provide: VAULT_CRYPTO, useValue: crypto },
        { provide: VAULT_OBJECT_STORE, useValue: createMockStorageProvider() },
        { provide: VAULT_SETTINGS, useValue: { getNamespace: jest.fn() } },
        { provide: VAULT_AUDIT, useValue: auditOverPrisma(prisma) },
      ],
    }).compile();
    service = module.get(SecretsService);
  });

  it('may be opened to agents', () => {
    expect(isAgentOpenableType(serviceKeyType)).toBe(true);
    expect(isAgentOpenableType({ name: 'Service Key', isSystem: false })).toBe(false);
  });

  it('normalizes service and key name and refuses an invalid id without echoing the value', () => {
    expect(normalizeServiceKeyData({ service: ' Web_Search', key_name: 'Provider_A', key: CANARY })).toEqual({
      service: 'web_search',
      key_name: 'provider_a',
      key: CANARY,
    });
    let error: unknown;
    try {
      normalizeServiceKeyData({ service: 'web search', key_name: 'a', key: CANARY });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({ details: { errors: [expect.stringContaining('Field "service"')] } });
    expect(JSON.stringify((error as BadRequestException).getResponse())).not.toContain(CANARY);
  });

  describe('create', () => {
    beforeEach(() => {
      prisma.secretType.findUnique.mockResolvedValue(serviceKeyType as any);
      prisma.secret.findFirst.mockResolvedValue(null as any);
      (prisma.secret.create as jest.Mock).mockImplementation(async (args: any) => ({ id: 'new-id', ...args.data, type: serviceKeyType }) as any);
      prisma.secretVersion.create.mockResolvedValue({} as any);
    });

    it('stores normalized ids, encrypted, and never an origin', async () => {
      prisma.secret.findMany.mockResolvedValue([] as any);
      const created = await service.create(
        { name: 'Search key', typeId: 't-sk', data: { service: 'Web_Search', key_name: 'provider_a', key: CANARY } } as any,
        USER,
        ['secrets:write'],
      );
      expect(created.values).toMatchObject({ service: 'web_search', key_name: 'provider_a' });
      expect((prisma.secret.create.mock.calls[0]![0] as any).data.origins).toBeUndefined();
      const version = (prisma.secretVersion.create.mock.calls[0]![0] as any).data;
      expect(version.encryptedData).not.toContain(CANARY);
      expect(JSON.stringify(prisma.auditEvent.create.mock.calls)).not.toContain(CANARY);
    });

    it('409 SERVICE_KEY_EXISTS when the owner already has that service and key name', async () => {
      prisma.secret.findMany.mockResolvedValue([
        { id: 'old', name: 'Old', versions: [encrypted({ service: 'web_search', key_name: 'provider_a', key: 'x' })] },
      ] as any);
      const attempt = service.create(
        { name: 'Second', typeId: 't-sk', data: { service: 'web_search', key_name: 'PROVIDER_A', key: CANARY } } as any,
        USER,
        ['secrets:write'],
      );
      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await attempt.catch((e: ConflictException) => expect((e.getResponse() as any).code).toBe('SERVICE_KEY_EXISTS'));
      expect(prisma.secret.create).not.toHaveBeenCalled();
      expect((prisma.secret.findMany.mock.calls[0]![0] as any).where).toMatchObject({ createdById: USER, type: { name: 'Service Key', isSystem: true } });
    });
  });

  describe('readOpenedServiceKey', () => {
    it('asks only for the owner\'s opened Service Keys and returns the one match', async () => {
      prisma.secret.findMany.mockResolvedValue([
        { id: 'a', name: 'A', versions: [encrypted({ service: 'web_search', key_name: 'provider_a', key: CANARY })] },
        { id: 'b', name: 'B', versions: [encrypted({ service: 'web_search', key_name: 'provider_b', key: 'other' })] },
        { id: 'c', name: 'C', versions: [] },
        { id: 'd', name: 'D', versions: [{ encryptedData: 'broken', iv: 'x', authTag: 'y' }] },
      ] as any);
      await expect(service.readOpenedServiceKey(USER, 'web_search', 'provider_a')).resolves.toEqual({
        kind: 'found', secretId: 'a', secretName: 'A', value: CANARY,
      });
      expect((prisma.secret.findMany.mock.calls[0]![0] as any).where).toEqual({
        createdById: USER, type: { name: 'Service Key', isSystem: true }, agentAccess: 'fill',
      });
      await expect(service.readOpenedServiceKey(USER, 'web_search', 'nothing')).resolves.toBeNull();
    });

    it('answers ambiguous for two matches and null for an empty value', async () => {
      prisma.secret.findMany.mockResolvedValue([
        { id: 'a', name: 'A', versions: [encrypted({ service: 'web_search', key_name: 'provider_a', key: CANARY })] },
        { id: 'b', name: 'B', versions: [encrypted({ service: 'web_search', key_name: 'provider_a', key: 'other' })] },
      ] as any);
      await expect(service.readOpenedServiceKey(USER, 'web_search', 'provider_a')).resolves.toEqual({ kind: 'ambiguous', secretIds: ['a', 'b'] });
      prisma.secret.findMany.mockResolvedValue([
        { id: 'a', name: 'A', versions: [encrypted({ service: 'web_search', key_name: 'provider_a', key: '' })] },
      ] as any);
      await expect(service.readOpenedServiceKey(USER, 'web_search', 'provider_a')).resolves.toBeNull();
    });
  });
});
