import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SYSTEM_SECRET_TYPES } from '@marinoscar/vault-contract/secret-types';

import { createMockPrismaService, freshTransactionClient, MockPrismaService } from '../../test/mocks/prisma.mock';
import { createMockStorageProvider } from '../../test/mocks/storage-provider.mock';
import { PERMISSIONS } from '../core/roles.constants';
import { VAULT_AUDIT, VAULT_CRYPTO, VAULT_OBJECT_STORE, VAULT_PRISMA, VAULT_SETTINGS } from '../ports';
import { auditOverPrisma } from '../testing';
import { SecretsService } from './secrets.service';

const userId = 'user-aaa';
const secretId = 'secret-111';
// 'JBSWY3DPEHPK3PXP' is a widely published example seed, not a real account secret.
const SEED = 'JBSWY3DPEHPK3PXP';
const CANONICAL = `otpauth://totp/?secret=${SEED}&algorithm=SHA1&digits=6&period=30`;

const credentialType = {
  id: 't1',
  name: 'Credential',
  isSystem: true,
  allowAttachments: false,
  fields: SYSTEM_SECRET_TYPES.find((t) => t.name === 'Credential')!.fields,
};
const apiKeyType = { ...credentialType, id: 't2', name: 'API Key', fields: [] };

describe('SecretsService TOTP', () => {
  let service: SecretsService;
  let prisma: MockPrismaService;
  let decrypt: jest.Mock;
  let encrypt: jest.Mock;
  const read = [PERMISSIONS.SECRETS_READ];

  beforeEach(async () => {
    prisma = createMockPrismaService();
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: unknown) =>
      typeof arg === 'function' ? arg(freshTransactionClient(prisma)) : arg,
    );
    prisma.auditEvent.create.mockResolvedValue({} as any);
    encrypt = jest.fn().mockReturnValue({ ciphertext: 'c', iv: 'i', authTag: 'a' });
    decrypt = jest.fn();
    const module = await Test.createTestingModule({
      providers: [
        SecretsService,
        { provide: VAULT_PRISMA, useValue: prisma },
        { provide: VAULT_CRYPTO, useValue: { encrypt, decrypt } },
        { provide: VAULT_OBJECT_STORE, useValue: createMockStorageProvider() },
        { provide: VAULT_SETTINGS, useValue: { getNamespace: jest.fn() } },
        { provide: VAULT_AUDIT, useValue: auditOverPrisma(prisma) },
      ],
    }).compile();
    service = module.get(SecretsService);
  });

  const stub = (type: unknown, data: Record<string, unknown> | null, owner = userId) => {
    const row = {
      id: secretId,
      name: 'Shop login',
      createdById: owner,
      type,
      versions: data ? [{ id: 'v1', encryptedData: 'x', iv: 'y', authTag: 'z', isCurrent: true }] : [],
    };
    prisma.secret.findUnique.mockResolvedValue(row as any);
    if (data) decrypt.mockReturnValue(JSON.stringify(data));
  };

  describe('create / update normalization and validation', () => {
    beforeEach(() => {
      prisma.secretType.findUnique.mockResolvedValue(credentialType as any);
      prisma.secret.findFirst.mockResolvedValue(null);
      prisma.secret.create.mockResolvedValue({ id: secretId, name: 'n', typeId: 't1', type: credentialType } as any);
      prisma.secretVersion.create.mockResolvedValue({} as any);
    });

    it('stores a bare base32 seed as the canonical URI', async () => {
      const result = await service.create(
        { name: 'n', typeId: 't1', data: { username: 'u', password: 'p', totp: 'jbsw y3dp ehpk 3pxp' } } as any,
        userId,
        read,
      );
      expect(encrypt).toHaveBeenCalledTimes(1);
      expect(JSON.parse(encrypt.mock.calls[0][0]).totp).toBe(CANONICAL);
      expect((result.values as any).totp).toBe(CANONICAL);
    });

    it('rejects an invalid seed with a field error and writes nothing', async () => {
      const err = await service
        .create({ name: 'n', typeId: 't1', data: { username: 'u', password: 'p', totp: 'not a seed!' } } as any, userId, read)
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(JSON.stringify(err.getResponse())).toContain('Field \\"totp\\"');
      expect(encrypt).not.toHaveBeenCalled();
      expect(prisma.secret.create).not.toHaveBeenCalled();
    });

    it('leaves credentials without totp unchanged', async () => {
      await service.create({ name: 'n', typeId: 't1', data: { username: 'u', password: 'p' } } as any, userId, read);
      expect(JSON.parse(encrypt.mock.calls[0][0])).toEqual({ username: 'u', password: 'p' });
    });

    it('ignores an empty totp', async () => {
      await service.create({ name: 'n', typeId: 't1', data: { username: 'u', password: 'p', totp: '' } } as any, userId, read);
      expect(JSON.parse(encrypt.mock.calls[0][0]).totp).toBe('');
    });

    it('update rejects an invalid seed', async () => {
      prisma.secret.findUnique.mockResolvedValue({ id: secretId, name: 'n', createdById: userId, type: credentialType } as any);
      await expect(
        service.update(secretId, { data: { username: 'u', password: 'p', totp: 'otpauth://hotp/a?secret=' + SEED } } as any, userId, [
          PERMISSIONS.SECRETS_WRITE,
        ]),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('readTotp', () => {
    it('returns code, expiresAt and period, never the seed, and audits ids only', async () => {
      stub(credentialType, { username: 'u', password: 'p', totp: CANONICAL });
      const result = await service.readTotp(secretId, userId, read);
      expect(Object.keys(result).sort()).toEqual(['code', 'expiresAt', 'period']);
      expect(result.code).toMatch(/^\d{6}$/);
      expect(JSON.stringify(result)).not.toContain(SEED);
      const audit = prisma.auditEvent.create.mock.calls[0][0].data as any;
      expect(audit.action).toBe('secret.totp.read');
      expect(audit.targetId).toBe(secretId);
      const serialized = JSON.stringify(audit);
      expect(serialized).not.toContain(SEED);
      expect(serialized).not.toContain(result.code);
    });

    it('404s when the Credential has no totp value', async () => {
      stub(credentialType, { username: 'u', password: 'p' });
      await expect(service.readTotp(secretId, userId, read)).rejects.toThrow(NotFoundException);
      expect(prisma.auditEvent.create).not.toHaveBeenCalled();
    });

    it('404s for a non-Credential type', async () => {
      stub(apiKeyType, { key: 'k', totp: CANONICAL });
      await expect(service.readTotp(secretId, userId, read)).rejects.toThrow(NotFoundException);
    });

    it('404s for a custom type named Credential', async () => {
      stub({ ...credentialType, isSystem: false }, { totp: CANONICAL });
      await expect(service.readTotp(secretId, userId, read)).rejects.toThrow(NotFoundException);
    });

    it("403s on someone else's secret without read_any", async () => {
      stub(credentialType, { totp: CANONICAL }, 'user-bbb');
      await expect(service.readTotp(secretId, userId, read)).rejects.toThrow(ForbiddenException);
    });

    it('404s when the secret does not exist', async () => {
      prisma.secret.findUnique.mockResolvedValue(null);
      await expect(service.readTotp(secretId, userId, read)).rejects.toThrow(NotFoundException);
    });
  });

  describe('generateTotpForSecret / hasTotp', () => {
    it('generates deterministically at a given time', async () => {
      stub(credentialType, { totp: CANONICAL });
      const a = await service.generateTotpForSecret(secretId, 59_000);
      expect(a.expiresAt).toBe(new Date(60_000).toISOString());
      expect(a.period).toBe(30);
    });

    it('hasTotp is true only for a Credential with a parseable value', () => {
      expect(service.hasTotp(credentialType, { totp: CANONICAL })).toBe(true);
      expect(service.hasTotp(credentialType, { totp: '' })).toBe(false);
      expect(service.hasTotp(credentialType, { totp: 'junk' })).toBe(false);
      expect(service.hasTotp(credentialType, {})).toBe(false);
      expect(service.hasTotp(apiKeyType, { totp: CANONICAL })).toBe(false);
      expect(service.hasTotp(credentialType, null)).toBe(false);
    });
  });
});
