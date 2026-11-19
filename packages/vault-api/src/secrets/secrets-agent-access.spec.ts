import { Test } from '@nestjs/testing';
import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { createMockPrismaService, freshTransactionClient, MockPrismaService } from '../../test/mocks/prisma.mock';
import { createMockStorageProvider } from '../../test/mocks/storage-provider.mock';
import { PERMISSIONS } from '../core/roles.constants';
import {
  VAULT_AUDIT,
  VAULT_CRYPTO,
  VAULT_OBJECT_STORE,
  VAULT_PRISMA,
  VAULT_SETTINGS,
} from '../ports';
import { auditOverPrisma } from '../testing';
import { secretListQuerySchema, updateAgentAccessSchema } from '@marinoscar/vault-contract/secrets';
import { VAULT_ERROR_CODES } from '@marinoscar/vault-contract/errors';
import { SecretsService, isAgentAccessibleType, isAgentOpenableType } from './secrets.service';
import { SecretsController } from './secrets.controller';

const userId = 'user-aaa';
const secretId = 'secret-111';
const credentialType = { id: 't1', name: 'Credential', isSystem: true, fields: [] };
const apiKeyType = { id: 't2', name: 'API Key', isSystem: true, fields: [] };
const customType = { id: 't3', name: 'Credential', isSystem: false, fields: [] };
const cardType = { id: 't4', name: 'Card', isSystem: true, fields: [] };
const identityType = { id: 't5', name: 'Identity', isSystem: true, fields: [] };
const passportType = { id: 't6', name: 'Passport', isSystem: true, fields: [] };
const idDocumentType = { id: 't7', name: 'ID Document', isSystem: true, fields: [] };

const secretRow = (over: Record<string, unknown> = {}) => ({
  id: secretId,
  name: 'Shop login',
  createdById: userId,
  type: credentialType,
  agentAccess: 'none',
  agentAccessChangedAt: null,
  ...over,
});

describe('SecretsService agent access', () => {
  let service: SecretsService;
  let prisma: MockPrismaService;
  const write = [PERMISSIONS.SECRETS_WRITE];

  beforeEach(async () => {
    prisma = createMockPrismaService();
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: unknown) =>
      typeof arg === 'function' ? arg(freshTransactionClient(prisma)) : arg,
    );
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

  describe('contract', () => {
    it('defaults the list filter to unset and accepts fill|none only', () => {
      expect(secretListQuerySchema.parse({}).agentAccess).toBeUndefined();
      expect(secretListQuerySchema.parse({ agentAccess: 'fill' }).agentAccess).toBe('fill');
      expect(secretListQuerySchema.safeParse({ agentAccess: 'all' }).success).toBe(false);
      expect(updateAgentAccessSchema.safeParse({ agentAccess: 'read' }).success).toBe(false);
    });

    it('registers the unsupported-type error as 422', () => {
      const def = VAULT_ERROR_CODES.find((d) => d.code === 'AGENT_ACCESS_UNSUPPORTED_TYPE');
      expect(def?.status).toBe(422);
    });
  });

  describe('updateAgentAccess', () => {
    it('sets fill on a Credential, stamps agentAccessChangedAt and audits ids and values only', async () => {
      prisma.secret.findUnique.mockResolvedValue(secretRow() as any);
      await service.updateAgentAccess(secretId, 'fill', userId, write);

      const arg = (prisma.secret.update as jest.Mock).mock.calls[0][0];
      expect(arg.where).toEqual({ id: secretId });
      expect(arg.data.agentAccess).toBe('fill');
      expect(arg.data.agentAccessChangedAt).toBeInstanceOf(Date);

      const audit = (prisma.auditEvent.create as jest.Mock).mock.calls[0][0].data;
      expect(audit.action).toBe('secret.agent_access.update');
      expect(audit.targetId).toBe(secretId);
      expect(audit.meta).toEqual({ secretId, from: 'none', to: 'fill' });
    });

    it('does nothing (no write, no audit) when the value is unchanged', async () => {
      prisma.secret.findUnique.mockResolvedValue(secretRow() as any);
      await service.updateAgentAccess(secretId, 'none', userId, write);
      expect(prisma.secret.update).not.toHaveBeenCalled();
      expect(prisma.auditEvent.create).not.toHaveBeenCalled();
    });

    it('allows none on any type', async () => {
      prisma.secret.findUnique.mockResolvedValue(
        secretRow({ type: apiKeyType, agentAccess: 'fill' }) as any,
      );
      await service.updateAgentAccess(secretId, 'none', userId, write);
      expect((prisma.secret.update as jest.Mock).mock.calls[0][0].data.agentAccess).toBe('none');
    });

    it.each([apiKeyType, customType])('answers 422 when setting fill on %p', async (type) => {
      prisma.secret.findUnique.mockResolvedValue(secretRow({ type }) as any);
      const err = await service.updateAgentAccess(secretId, 'fill', userId, write).catch((e) => e);
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect(err.getResponse().code).toBe('AGENT_ACCESS_UNSUPPORTED_TYPE');
      expect(prisma.secret.update).not.toHaveBeenCalled();
    });

    it.each([passportType, idDocumentType])(
      'answers 422 when setting fill on the identity document %p, even from the owner\'s session (ADR-0004)',
      async (type) => {
        expect(isAgentAccessibleType(type)).toBe(false);
        expect(isAgentOpenableType(type)).toBe(false);
        prisma.secret.findUnique.mockResolvedValue(secretRow({ type }) as any);
        for (const ownerSession of [false, true]) {
          const err = await service
            .updateAgentAccess(secretId, 'fill', userId, write, undefined, ownerSession)
            .catch((e) => e);
          expect(err).toBeInstanceOf(UnprocessableEntityException);
          expect(err.getResponse().code).toBe('AGENT_ACCESS_UNSUPPORTED_TYPE');
        }
        expect(prisma.secret.update).not.toHaveBeenCalled();
      },
    );

    it.each([cardType, identityType])('opens a system %p only with the owner\'s browser session (ADR-0003)', async (type) => {
      prisma.secret.findUnique.mockResolvedValue(secretRow({ type }) as any);
      const err = await service.updateAgentAccess(secretId, 'fill', userId, write).catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse().code).toBe('OWNER_SESSION_REQUIRED');
      expect(prisma.secret.update).not.toHaveBeenCalled();
      await service.updateAgentAccess(secretId, 'fill', userId, write, undefined, true);
      expect((prisma.secret.update as jest.Mock).mock.calls[0][0].data.agentAccess).toBe('fill');
    });

    it('closes a card without a session (closing only narrows access)', async () => {
      prisma.secret.findUnique.mockResolvedValue(secretRow({ type: cardType, agentAccess: 'fill' }) as any);
      await service.updateAgentAccess(secretId, 'none', userId, write);
      expect((prisma.secret.update as jest.Mock).mock.calls[0][0].data.agentAccess).toBe('none');
    });

    it('stores normalized, deduplicated allowed origins on an Identity and audits only their count', async () => {
      prisma.secret.findUnique.mockResolvedValue(secretRow({ type: identityType, agentAccess: 'fill', agentOrigins: [] }) as any);
      await service.updateAgentAccess(
        secretId, 'fill', userId, write, ['HTTPS://Form.Example.Test/apply', 'form.example.test', 'https://b.example.test'], true,
      );
      expect((prisma.secret.update as jest.Mock).mock.calls[0][0].data).toEqual({
        agentOrigins: ['https://b.example.test', 'https://form.example.test'],
      });
      expect((prisma.auditEvent.create as jest.Mock).mock.calls[0][0].data.meta).toEqual({
        secretId, from: 'fill', to: 'fill', allowedOrigins: 2,
      });
    });

    it('refuses allowed origins on another type, an invalid origin, and without a session', async () => {
      prisma.secret.findUnique.mockResolvedValue(secretRow({ type: cardType }) as any);
      await expect(service.updateAgentAccess(secretId, 'fill', userId, write, ['https://a.example.test'], true)).rejects.toThrow('Identity');
      prisma.secret.findUnique.mockResolvedValue(secretRow({ type: identityType }) as any);
      await expect(service.updateAgentAccess(secretId, 'fill', userId, write, ['ftp://a.example.test'], true)).rejects.toThrow('invalid');
      await expect(service.updateAgentAccess(secretId, 'none', userId, write, [], false)).rejects.toThrow(ForbiddenException);
      expect(prisma.secret.update).not.toHaveBeenCalled();
    });

    it('mirrors update: 404 when missing, 403 for another user without write_any', async () => {
      prisma.secret.findUnique.mockResolvedValue(null);
      await expect(service.updateAgentAccess(secretId, 'fill', userId, write)).rejects.toThrow(NotFoundException);
      prisma.secret.findUnique.mockResolvedValue(secretRow({ createdById: 'other' }) as any);
      await expect(service.updateAgentAccess(secretId, 'fill', userId, write)).rejects.toThrow(ForbiddenException);
      await expect(
        service.updateAgentAccess(secretId, 'fill', userId, [PERMISSIONS.SECRETS_WRITE_ANY]),
      ).resolves.toBeDefined();
    });
  });

  describe('list filter', () => {
    it('passes agentAccess into the where clause', async () => {
      prisma.secret.findMany.mockResolvedValue([] as any);
      prisma.secret.count.mockResolvedValue(0 as any);
      await service.findAll(
        { page: 1, pageSize: 20, sortBy: 'updatedAt', sortOrder: 'desc', agentAccess: 'fill' },
        userId,
        [PERMISSIONS.SECRETS_READ],
      );
      const where = (prisma.secret.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where).toMatchObject({ createdById: userId, agentAccess: 'fill' });
    });

    it('omits the filter when unset', async () => {
      prisma.secret.findMany.mockResolvedValue([] as any);
      prisma.secret.count.mockResolvedValue(0 as any);
      await service.findAll(
        { page: 1, pageSize: 20, sortBy: 'updatedAt', sortOrder: 'desc' },
        userId,
        [PERMISSIONS.SECRETS_READ],
      );
      expect((prisma.secret.findMany as jest.Mock).mock.calls[0][0].where).not.toHaveProperty('agentAccess');
    });
  });

  describe('assertAgentAccessible / findAgentAccessibleSecret', () => {
    it('passes for a fill Credential', () => {
      expect(() => service.assertAgentAccessible(secretRow({ agentAccess: 'fill' }))).not.toThrow();
    });

    it.each([
      ['missing', null],
      ['none', secretRow()],
      ['non-Credential', secretRow({ agentAccess: 'fill', type: apiKeyType })],
    ])('answers the same 404 for %s', (_n, secret) => {
      expect(() => service.assertAgentAccessible(secret as any)).toThrow(NotFoundException);
    });

    it('findAgentAccessibleSecret scopes to the owner and fill, returning null otherwise', async () => {
      prisma.secret.findFirst.mockResolvedValue(secretRow({ agentAccess: 'fill' }) as any);
      expect(await service.findAgentAccessibleSecret(userId, secretId)).not.toBeNull();
      expect((prisma.secret.findFirst as jest.Mock).mock.calls[0][0].where).toEqual({
        id: secretId,
        createdById: userId,
        agentAccess: 'fill',
      });

      prisma.secret.findFirst.mockResolvedValue(null);
      expect(await service.findAgentAccessibleSecret(userId, secretId)).toBeNull();

      prisma.secret.findFirst.mockResolvedValue(secretRow({ agentAccess: 'fill', type: apiKeyType }) as any);
      expect(await service.findAgentAccessibleSecret(userId, secretId)).toBeNull();
    });
  });
});

describe('SecretsController agent-access route', () => {
  const user = { id: userId, permissions: [PERMISSIONS.SECRETS_WRITE] } as any;
  const svc = { updateAgentAccess: jest.fn().mockResolvedValue({ id: secretId, agentAccess: 'fill' }) };
  const controller = new SecretsController(svc as any, {} as any, {} as any);

  beforeEach(() => svc.updateAgentAccess.mockClear());

  it('refuses an OAuth credential with 403 and never reaches the service', async () => {
    const oauth = { kind: 'oauth', tokenId: 't', grantId: 'g', clientId: 'c', resourceId: 'agent', scopes: [] } as any;
    await expect(
      controller.updateAgentAccess(secretId, { agentAccess: 'fill' }, user, oauth),
    ).rejects.toThrow(ForbiddenException);
    expect(svc.updateAgentAccess).not.toHaveBeenCalled();
  });

  it.each([{ kind: 'jwt' }, { kind: 'pat', tokenId: 'p' }, null])('allows %p', async (cred) => {
    const out = await controller.updateAgentAccess(secretId, { agentAccess: 'fill' }, user, cred as any);
    expect(out).toEqual({ data: { id: secretId, agentAccess: 'fill' } });
    expect(svc.updateAgentAccess).toHaveBeenCalledWith(secretId, 'fill', userId, user.permissions, undefined, (cred as { kind?: string } | null)?.kind === 'jwt');
  });

  it('passes allowedOrigins and whether the caller is a browser session', async () => {
    await controller.updateAgentAccess(secretId, { agentAccess: 'fill', allowedOrigins: ['https://form.example.test'] }, user, { kind: 'pat', tokenId: 'p' } as any);
    expect(svc.updateAgentAccess).toHaveBeenCalledWith(secretId, 'fill', userId, user.permissions, ['https://form.example.test'], false);
  });
});
