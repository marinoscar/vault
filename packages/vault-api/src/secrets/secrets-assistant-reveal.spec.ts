import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

import { createMockPrismaService, freshTransactionClient, MockPrismaService } from '../../test/mocks/prisma.mock';
import { createMockStorageProvider } from '../../test/mocks/storage-provider.mock';
import { PERMISSIONS } from '../core/roles.constants';
import { VAULT_AUDIT, VAULT_CRYPTO, VAULT_OBJECT_STORE, VAULT_PRISMA, VAULT_SETTINGS } from '../ports';
import { auditOverPrisma } from '../testing';
import { secretListQuerySchema, updateAssistantRevealSchema } from '@marinoscar/vault-contract/secrets';
import { VAULT_ERROR_CODES } from '@marinoscar/vault-contract/errors';
import { SecretsService } from './secrets.service';
import { SecretsController } from './secrets.controller';

const userId = 'user-aaa';
const secretId = 'secret-111';
const type = (name: string, over: Record<string, unknown> = {}) => ({ id: `t-${name}`, name, isSystem: true, fields: [], ...over });
const row = (over: Record<string, unknown> = {}) => ({
  id: secretId,
  name: 'Wifi',
  createdById: userId,
  type: type('Secure Note'),
  assistantReveal: false,
  assistantRevealChangedAt: null,
  ...over,
});

describe('SecretsService.updateAssistantReveal (#244)', () => {
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

  it('switches it on, stamps the change time and audits the two states only', async () => {
    prisma.secret.findFirst.mockResolvedValue(row() as any);
    await service.updateAssistantReveal(secretId, true, userId, write);
    expect(prisma.secret.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: secretId, createdById: userId } }));
    const arg = (prisma.secret.update as jest.Mock).mock.calls[0][0];
    expect(arg.data.assistantReveal).toBe(true);
    expect(arg.data.assistantRevealChangedAt).toBeInstanceOf(Date);
    const audit = (prisma.auditEvent.create as jest.Mock).mock.calls[0][0].data;
    expect(audit.action).toBe('secret.assistant_reveal.update');
    expect(audit.meta).toEqual({ secretId, from: false, to: true });
  });

  it('does nothing (no write, no audit) when unchanged', async () => {
    prisma.secret.findFirst.mockResolvedValue(row({ assistantReveal: true }) as any);
    await service.updateAssistantReveal(secretId, true, userId, write);
    expect(prisma.secret.update).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('is owner only: a missing or foreign secret is 404, even with secrets:write_any', async () => {
    prisma.secret.findFirst.mockResolvedValue(null);
    const err = await service.updateAssistantReveal(secretId, true, 'admin-1', [PERMISSIONS.SECRETS_WRITE, 'secrets:write_any']).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(prisma.secret.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: secretId, createdById: 'admin-1' } }));
    expect(prisma.secret.update).not.toHaveBeenCalled();
  });

  it.each(['Card', 'Passport', 'ID Document'])('answers 422 ASSISTANT_REVEAL_UNSUPPORTED_TYPE for the system %s', async (name) => {
    prisma.secret.findFirst.mockResolvedValue(row({ type: type(name) }) as any);
    const err = await service.updateAssistantReveal(secretId, true, userId, write).catch((e) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect(err.getResponse().code).toBe('ASSISTANT_REVEAL_UNSUPPORTED_TYPE');
    expect(prisma.secret.update).not.toHaveBeenCalled();
  });

  it('answers 422 for a custom type with a cvv-like field, and still lets the owner switch it OFF', async () => {
    const odd = type('Gift Card', { isSystem: false, fields: [{ name: 'cvv', type: 'text' }] });
    prisma.secret.findFirst.mockResolvedValue(row({ type: odd }) as any);
    await expect(service.updateAssistantReveal(secretId, true, userId, write)).rejects.toBeInstanceOf(UnprocessableEntityException);
    prisma.secret.findFirst.mockResolvedValue(row({ type: odd, assistantReveal: true }) as any);
    await service.updateAssistantReveal(secretId, false, userId, write);
    expect((prisma.secret.update as jest.Mock).mock.calls[0][0].data.assistantReveal).toBe(false);
  });

  it('allows a Credential, an API Key and a custom type', async () => {
    for (const t of [type('Credential'), type('API Key'), type('Wifi', { isSystem: false })]) {
      prisma.secret.update.mockClear();
      prisma.secret.findFirst.mockResolvedValue(row({ type: t }) as any);
      await service.updateAssistantReveal(secretId, true, userId, write);
      expect(prisma.secret.update).toHaveBeenCalledTimes(1);
    }
  });

  it('the list filter parses assistantReveal=true|false', () => {
    expect(secretListQuerySchema.parse({}).assistantReveal).toBeUndefined();
    expect(secretListQuerySchema.parse({ assistantReveal: 'true' }).assistantReveal).toBe(true);
    expect(secretListQuerySchema.parse({ assistantReveal: 'false' }).assistantReveal).toBe(false);
    expect(secretListQuerySchema.safeParse({ assistantReveal: 'maybe' }).success).toBe(false);
  });

  it('findAll passes the filter to the query', async () => {
    prisma.secret.findMany.mockResolvedValue([]);
    prisma.secret.count.mockResolvedValue(0);
    await service.findAll(secretListQuerySchema.parse({ assistantReveal: 'true' }) as any, userId, write);
    expect((prisma.secret.findMany as jest.Mock).mock.calls[0][0].where).toMatchObject({ createdById: userId, assistantReveal: true });
  });

  it('declares the body and the 422 error code', () => {
    expect(updateAssistantRevealSchema.safeParse({ enabled: true }).success).toBe(true);
    expect(updateAssistantRevealSchema.safeParse({ enabled: 'yes' }).success).toBe(false);
    expect(updateAssistantRevealSchema.safeParse({}).success).toBe(false);
    expect(VAULT_ERROR_CODES.find((d) => d.code === 'ASSISTANT_REVEAL_UNSUPPORTED_TYPE')?.status).toBe(422);
  });
});

describe('SecretsController assistant-reveal route (#244)', () => {
  const user = { id: userId, permissions: [PERMISSIONS.SECRETS_WRITE] } as any;
  const svc = { updateAssistantReveal: jest.fn().mockResolvedValue({ id: secretId, assistantReveal: true }) };
  const controller = new SecretsController(svc as any, {} as any, {} as any, {} as any);

  beforeEach(() => svc.updateAssistantReveal.mockClear());

  it('refuses an OAuth oat_ credential with 403 and never reaches the service', async () => {
    const oauth = { kind: 'oauth', tokenId: 't', grantId: 'g', clientId: 'c', resourceId: 'mcp', scopes: ['vault:mcp_write'] } as any;
    await expect(controller.updateAssistantReveal(secretId, { enabled: true }, user, oauth)).rejects.toThrow(ForbiddenException);
    expect(svc.updateAssistantReveal).not.toHaveBeenCalled();
  });

  it.each([{ kind: 'jwt' }, { kind: 'pat', tokenId: 'p' }, null])('allows %p (a browser session and a pat_ token)', async (cred) => {
    const out = await controller.updateAssistantReveal(secretId, { enabled: true }, user, cred as any);
    expect(out).toEqual({ data: { id: secretId, assistantReveal: true } });
    expect(svc.updateAssistantReveal).toHaveBeenCalledWith(secretId, true, userId, user.permissions);
  });
});
