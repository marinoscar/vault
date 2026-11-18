import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';

import { createMockPrismaService, freshTransactionClient, MockPrismaService } from '../../test/mocks/prisma.mock';
import { createMockStorageProvider } from '../../test/mocks/storage-provider.mock';
import { VAULT_AUDIT, VAULT_CRYPTO, VAULT_OBJECT_STORE, VAULT_PRISMA, VAULT_SETTINGS } from '../ports';
import { auditOverPrisma, TestCrypto } from '../testing';
import { SecretsService } from './secrets.service';

const USER = 'user-aaa';
const credentialType = {
  id: 't-cred', name: 'Credential', isSystem: true,
  fields: [
    { name: 'username', label: 'Username', type: 'string', required: true, sensitive: false },
    { name: 'password', label: 'Password', type: 'string', required: true, sensitive: true },
    { name: 'url', label: 'URL', type: 'string', required: false, sensitive: false },
    { name: 'additional_urls', label: 'x', type: 'string', required: false, sensitive: false },
    { name: 'totp', label: 'totp', type: 'string', required: false, sensitive: true },
  ],
};

describe('SecretsService agent API support', () => {
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

  it('readCurrentValues decrypts the current version, 404 without one', async () => {
    prisma.secretVersion.findFirst.mockResolvedValue({ ...encrypted({ username: 'u', password: 'p' }) } as any);
    await expect(service.readCurrentValues('s1')).resolves.toEqual({ username: 'u', password: 'p' });
    prisma.secretVersion.findFirst.mockResolvedValue(null as any);
    await expect(service.readCurrentValues('s1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('describeAgentCredentials returns username, hasTotp and updatedAt only', async () => {
    const updatedAt = new Date('2030-01-01T00:00:00Z');
    prisma.secret.findMany.mockResolvedValue([
      { id: 'a', updatedAt, type: credentialType, versions: [encrypted({ username: 'u1', password: 'pw-canary', totp: 'JBSWY3DPEHPK3PXP' })] },
      { id: 'b', updatedAt, type: credentialType, versions: [encrypted({ username: 'u2', password: 'pw-canary' })] },
      { id: 'c', updatedAt, type: { name: 'API Key', isSystem: true }, versions: [encrypted({ key: 'k' })] },
    ] as any);
    const out = await service.describeAgentCredentials(['a', 'b', 'c']);
    expect(out.get('a')).toEqual({ username: 'u1', hasTotp: true, updatedAt: updatedAt.toISOString() });
    expect(out.get('b')).toEqual({ username: 'u2', hasTotp: false, updatedAt: updatedAt.toISOString() });
    expect(out.has('c')).toBe(false);
    expect(JSON.stringify([...out])).not.toContain('pw-canary');
    expect((await service.describeAgentCredentials([])).size).toBe(0);
  });

  describe('createAgentCredential', () => {
    beforeEach(() => {
      prisma.secretType.findFirst.mockResolvedValue(credentialType as any);
      prisma.secret.findFirst.mockResolvedValue(null as any);
      (prisma.secret.create as jest.Mock).mockImplementation(async (args: any) => ({ id: 'new-id', ...args.data, type: credentialType }) as any);
      prisma.secretVersion.create.mockResolvedValue({} as any);
    });

    it('creates an agent-opened Credential owned by the caller with derived origins and an encrypted version', async () => {
      const result = await service.createAgentCredential(USER, {
        name: 'Shop',
        values: { username: 'u', password: 'pw-canary', url: 'https://shop.example.test', additional_urls: 'https://m.example.test' },
      });
      expect(result).toEqual({ id: 'new-id', name: 'Shop', origins: ['https://m.example.test', 'https://shop.example.test'] });
      const secretData = (prisma.secret.create.mock.calls[0]![0] as any).data;
      expect(secretData).toMatchObject({ createdById: USER, agentAccess: 'fill', typeId: 't-cred' });
      expect(secretData.agentAccessChangedAt).toBeInstanceOf(Date);
      const versionData = (prisma.secretVersion.create.mock.calls[0]![0] as any).data;
      expect(versionData).toMatchObject({ version: 1, isCurrent: true });
      expect(versionData.encryptedData).not.toContain('pw-canary');
      expect(JSON.stringify(prisma.auditEvent.create.mock.calls)).not.toContain('pw-canary');
    });

    it('409 on a name clash', async () => {
      prisma.secret.findFirst.mockResolvedValue({ id: 'x' } as any);
      await expect(service.createAgentCredential(USER, { name: 'Shop', values: { username: 'u', password: 'p' } })).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('rotateCredentialPassword', () => {
    it('creates a new current version with only the password changed and keeps the origins', async () => {
      prisma.secret.findUnique.mockResolvedValue({ id: 's1', name: 'Shop', type: credentialType } as any);
      prisma.secretVersion.findFirst
        .mockResolvedValueOnce({ ...encrypted({ username: 'u', password: 'old', url: 'https://shop.example.test' }) } as any) // readCurrentValues
        .mockResolvedValueOnce({ version: 1 } as any) // max version
        .mockResolvedValueOnce({ id: 'v1' } as any); // current version (carry-forward source)
      prisma.secretVersion.updateMany.mockResolvedValue({} as any);
      (prisma.secretVersion.create as jest.Mock).mockImplementation(async (args: any) => ({ id: 'v2', ...args.data }) as any);
      prisma.secret.update.mockResolvedValue({} as any);
      (prisma.secretAttachment.findMany as jest.Mock).mockResolvedValue([]);

      await expect(service.rotateCredentialPassword('s1', USER, 'new-pw')).resolves.toEqual({ version: 2 });
      const created = (prisma.secretVersion.create.mock.calls[0]![0] as any).data;
      expect(created).toMatchObject({ version: 2, isCurrent: true, createdById: USER });
      const plain = crypto.decrypt(created.encryptedData, created.iv, created.authTag);
      expect(JSON.parse(plain)).toEqual({ username: 'u', password: 'new-pw', url: 'https://shop.example.test' });
      expect((prisma.secret.update.mock.calls[0]![0] as any).data).toEqual({ origins: ['https://shop.example.test'] });
      expect(JSON.stringify(prisma.auditEvent.create.mock.calls)).not.toContain('new-pw');
    });

    it('404 for a non-Credential or missing secret', async () => {
      prisma.secret.findUnique.mockResolvedValue({ id: 's1', type: { name: 'API Key', isSystem: true } } as any);
      await expect(service.rotateCredentialPassword('s1', USER, 'x')).rejects.toBeInstanceOf(NotFoundException);
      prisma.secret.findUnique.mockResolvedValue(null as any);
      await expect(service.rotateCredentialPassword('s1', USER, 'x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
