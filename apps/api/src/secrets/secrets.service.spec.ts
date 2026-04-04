import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';

import { SecretsService } from './secrets.service';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/services/crypto.service';
import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import { PERMISSIONS } from '../common/constants/roles.constants';
import { CreateSecretDto } from './dto/create-secret.dto';
import { UpdateSecretDto } from './dto/update-secret.dto';
import { SecretListQueryDto } from './dto/secret-list-query.dto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDefaultQuery(overrides: Partial<SecretListQueryDto> = {}): SecretListQueryDto {
  return {
    page: 1,
    pageSize: 20,
    sortBy: 'updatedAt',
    sortOrder: 'desc',
    ...overrides,
  };
}

describe('SecretsService', () => {
  let service: SecretsService;
  let mockPrisma: MockPrismaService;
  let mockCrypto: jest.Mocked<Pick<CryptoService, 'encrypt' | 'decrypt'>>;

  const userId = 'user-aaa';
  const otherUserId = 'user-bbb';
  const secretId = 'secret-111';
  const typeId = 'type-222';
  const versionId = 'version-333';

  const encryptedPayload = {
    ciphertext: 'base64ciphertext==',
    iv: 'base64iv==',
    authTag: 'base64tag==',
  };

  const rawData = { username: 'test', password: 'secret' };
  const rawDataJson = JSON.stringify(rawData);

  const mockSecretType = {
    id: typeId,
    name: 'Login',
    description: null,
    icon: null,
    fields: [
      { name: 'username', label: 'Username', type: 'string', required: true, sensitive: false },
      { name: 'password', label: 'Password', type: 'string', required: true, sensitive: true },
    ],
    allowAttachments: false,
    isSystem: false,
    createdById: userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSecret = {
    id: secretId,
    name: 'My Login',
    description: null,
    typeId,
    createdById: userId,
    type: mockSecretType,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockVersion = {
    id: versionId,
    secretId,
    version: 1,
    encryptedData: encryptedPayload.ciphertext,
    iv: encryptedPayload.iv,
    authTag: encryptedPayload.authTag,
    isCurrent: true,
    createdById: userId,
    createdBy: { id: userId, email: 'user@example.com', name: 'Test User' },
    createdAt: new Date(),
  };

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();

    mockCrypto = {
      encrypt: jest.fn().mockReturnValue(encryptedPayload),
      decrypt: jest.fn().mockReturnValue(rawDataJson),
    };

    // Wire $transaction to run the callback synchronously with the same mock
    (mockPrisma.$transaction as jest.Mock).mockImplementation(
      async (arg: unknown) => {
        if (typeof arg === 'function') {
          return arg(mockPrisma);
        }
        if (Array.isArray(arg)) {
          return Promise.all(arg);
        }
        return arg;
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecretsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CryptoService, useValue: mockCrypto },
      ],
    }).compile();

    service = module.get<SecretsService>(SecretsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // create
  // ============================================================================

  describe('create', () => {
    const createDto: CreateSecretDto = {
      name: 'My Login',
      typeId,
      data: rawData,
    } as CreateSecretDto;

    const ownerPerms = [PERMISSIONS.SECRETS_WRITE];

    beforeEach(() => {
      mockPrisma.secretType.findUnique.mockResolvedValue(mockSecretType as any);
      mockPrisma.secret.create.mockResolvedValue(mockSecret as any);
      mockPrisma.secretVersion.create.mockResolvedValue(mockVersion as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);
    });

    it('should encrypt the data before storing', async () => {
      await service.create(createDto, userId, ownerPerms);

      expect(mockCrypto.encrypt).toHaveBeenCalledWith(JSON.stringify(rawData));
    });

    it('should create the secret record inside the transaction', async () => {
      await service.create(createDto, userId, ownerPerms);

      expect(mockPrisma.secret.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'My Login',
            typeId,
            createdById: userId,
          }),
        }),
      );
    });

    it('should create the first version with isCurrent=true and version=1', async () => {
      await service.create(createDto, userId, ownerPerms);

      expect(mockPrisma.secretVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            secretId,
            version: 1,
            isCurrent: true,
            encryptedData: encryptedPayload.ciphertext,
            iv: encryptedPayload.iv,
            authTag: encryptedPayload.authTag,
          }),
        }),
      );
    });

    it('should return the secret with the original data attached', async () => {
      const result = await service.create(createDto, userId, ownerPerms);

      expect(result.values).toEqual(rawData);
      expect(result.id).toBe(secretId);
    });

    it('should throw NotFoundException when the secret type does not exist', async () => {
      mockPrisma.secretType.findUnique.mockResolvedValue(null);

      await expect(service.create(createDto, userId, ownerPerms)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.create(createDto, userId, ownerPerms)).rejects.toThrow(
        'Secret type not found',
      );
    });

    it('should create an audit event after creation', async () => {
      await service.create(createDto, userId, ownerPerms);

      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: userId,
          action: 'secret.create',
          targetId: secretId,
        }),
      });
    });
  });

  // ============================================================================
  // findAll
  // ============================================================================

  describe('findAll', () => {
    beforeEach(() => {
      mockPrisma.secret.findMany.mockResolvedValue([
        {
          ...mockSecret,
          versions: [{ version: 1 }],
        },
      ] as any);
      mockPrisma.secret.count.mockResolvedValue(1 as any);
    });

    it('should filter by createdById when caller does not have read_any permission', async () => {
      const perms = [PERMISSIONS.SECRETS_READ];
      await service.findAll(buildDefaultQuery(), userId, perms);

      const callArg = (mockPrisma.secret.findMany as jest.Mock).mock.calls[0][0];
      expect(callArg.where).toHaveProperty('createdById', userId);
    });

    it('should not scope by ownership when caller has read_any permission', async () => {
      const perms = [PERMISSIONS.SECRETS_READ_ANY];
      await service.findAll(buildDefaultQuery(), userId, perms);

      const callArg = (mockPrisma.secret.findMany as jest.Mock).mock.calls[0][0];
      expect(callArg.where).not.toHaveProperty('createdById');
    });

    it('should apply typeId filter when provided', async () => {
      const perms = [PERMISSIONS.SECRETS_READ_ANY];
      await service.findAll(buildDefaultQuery({ typeId }), userId, perms);

      const callArg = (mockPrisma.secret.findMany as jest.Mock).mock.calls[0][0];
      expect(callArg.where).toHaveProperty('typeId', typeId);
    });

    it('should apply case-insensitive name search when search is provided', async () => {
      const perms = [PERMISSIONS.SECRETS_READ_ANY];
      await service.findAll(buildDefaultQuery({ search: 'login' }), userId, perms);

      const callArg = (mockPrisma.secret.findMany as jest.Mock).mock.calls[0][0];
      expect(callArg.where.name).toEqual({ contains: 'login', mode: 'insensitive' });
    });

    it('should apply skip/take pagination', async () => {
      const perms = [PERMISSIONS.SECRETS_READ];
      await service.findAll(buildDefaultQuery({ page: 2, pageSize: 10 }), userId, perms);

      const callArg = (mockPrisma.secret.findMany as jest.Mock).mock.calls[0][0];
      expect(callArg.skip).toBe(10);
      expect(callArg.take).toBe(10);
    });

    it('should return pagination meta', async () => {
      mockPrisma.secret.count.mockResolvedValue(42 as any);
      const perms = [PERMISSIONS.SECRETS_READ_ANY];

      const result = await service.findAll(buildDefaultQuery({ pageSize: 10 }), userId, perms);

      expect(result.meta).toEqual(
        expect.objectContaining({
          page: 1,
          pageSize: 10,
          totalItems: 42,
          totalPages: 5,
        }),
      );
    });

    it('should include currentVersion from the first isCurrent version', async () => {
      mockPrisma.secret.findMany.mockResolvedValue([
        { ...mockSecret, versions: [{ version: 3 }] },
      ] as any);
      mockPrisma.secret.count.mockResolvedValue(1 as any);

      const result = await service.findAll(buildDefaultQuery(), userId, [PERMISSIONS.SECRETS_READ]);

      expect(result.items[0].currentVersion).toBe(3);
    });

    it('should set currentVersion to null when there are no versions', async () => {
      mockPrisma.secret.findMany.mockResolvedValue([
        { ...mockSecret, versions: [] },
      ] as any);
      mockPrisma.secret.count.mockResolvedValue(1 as any);

      const result = await service.findAll(buildDefaultQuery(), userId, [PERMISSIONS.SECRETS_READ]);

      expect(result.items[0].currentVersion).toBeNull();
    });
  });

  // ============================================================================
  // findOne
  // ============================================================================

  describe('findOne', () => {
    const fullSecretDetail = {
      ...mockSecret,
      versions: [mockVersion],
      attachments: [],
    };

    it('should return the secret with decrypted data', async () => {
      // findOne calls findUnique twice: once for auth check, once for full detail
      mockPrisma.secret.findUnique
        .mockResolvedValueOnce(mockSecret as any)
        .mockResolvedValueOnce(fullSecretDetail as any);

      const perms = [PERMISSIONS.SECRETS_READ];
      const result = await service.findOne(secretId, userId, perms);

      expect(mockCrypto.decrypt).toHaveBeenCalledWith(
        encryptedPayload.ciphertext,
        encryptedPayload.iv,
        encryptedPayload.authTag,
      );
      expect(result.values).toEqual(rawData);
    });

    it('should throw NotFoundException when the secret does not exist', async () => {
      // Auth check returns null — service throws immediately
      mockPrisma.secret.findUnique.mockResolvedValueOnce(null);
      const perms = [PERMISSIONS.SECRETS_READ];

      await expect(service.findOne('nonexistent', userId, perms)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when a non-owner lacks read_any permission', async () => {
      // Auth check finds the secret, but caller is not the owner and has no _any perm
      mockPrisma.secret.findUnique.mockResolvedValueOnce(mockSecret as any);
      const perms: string[] = [];

      await expect(service.findOne(secretId, otherUserId, perms)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should allow access when caller has read_any permission and is not the owner', async () => {
      mockPrisma.secret.findUnique
        .mockResolvedValueOnce(mockSecret as any)   // auth check
        .mockResolvedValueOnce(fullSecretDetail as any); // detail fetch

      const perms = [PERMISSIONS.SECRETS_READ_ANY];

      await expect(service.findOne(secretId, otherUserId, perms)).resolves.toBeDefined();
    });
  });

  // ============================================================================
  // update
  // ============================================================================

  describe('update', () => {
    const updateDto: UpdateSecretDto = {
      data: { username: 'new_user', password: 'new_pass' },
    } as UpdateSecretDto;

    beforeEach(() => {
      // Auth check
      mockPrisma.secret.findUnique.mockResolvedValue(mockSecret as any);
      // Fetch for validation
      mockPrisma.secret.update.mockResolvedValue(mockSecret as any);
      // Version management
      mockPrisma.secretVersion.findFirst.mockResolvedValue({ version: 1 } as any);
      mockPrisma.secretVersion.updateMany.mockResolvedValue({ count: 1 } as any);
      mockPrisma.secretVersion.create.mockResolvedValue(mockVersion as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      // findOne calls for the return value at end of update
      // We need to set up the chain for update -> findOne -> (auth check, detail fetch)
      mockPrisma.secret.findUnique
        .mockResolvedValueOnce(mockSecret as any) // initial auth check in update
        .mockResolvedValueOnce(mockSecret as any) // existingSecret fetch
        .mockResolvedValueOnce(mockSecret as any) // findOne auth check
        .mockResolvedValueOnce({
          ...mockSecret,
          versions: [mockVersion],
          attachments: [],
        } as any); // findOne detail
    });

    it('should encrypt the new data when data is provided', async () => {
      const perms = [PERMISSIONS.SECRETS_WRITE];
      await service.update(secretId, updateDto, userId, perms);

      expect(mockCrypto.encrypt).toHaveBeenCalledWith(JSON.stringify(updateDto.data));
    });

    it('should mark all existing versions as not current before creating a new one', async () => {
      const perms = [PERMISSIONS.SECRETS_WRITE];
      await service.update(secretId, updateDto, userId, perms);

      expect(mockPrisma.secretVersion.updateMany).toHaveBeenCalledWith({
        where: { secretId },
        data: { isCurrent: false },
      });
    });

    it('should create a new version with an incremented version number', async () => {
      const perms = [PERMISSIONS.SECRETS_WRITE];
      await service.update(secretId, updateDto, userId, perms);

      expect(mockPrisma.secretVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            secretId,
            version: 2, // max (1) + 1
            isCurrent: true,
          }),
        }),
      );
    });

    it('should not create a new version when data is not changed', async () => {
      // Reset the mock chain for this specific test
      mockPrisma.secret.findUnique
        .mockResolvedValueOnce(mockSecret as any)
        .mockResolvedValueOnce(mockSecret as any)
        .mockResolvedValueOnce(mockSecret as any)
        .mockResolvedValueOnce({
          ...mockSecret,
          versions: [mockVersion],
          attachments: [],
        } as any);

      const noDataDto: UpdateSecretDto = { name: 'Renamed Only' } as UpdateSecretDto;
      const perms = [PERMISSIONS.SECRETS_WRITE];
      await service.update(secretId, noDataDto, userId, perms);

      expect(mockCrypto.encrypt).not.toHaveBeenCalled();
      expect(mockPrisma.secretVersion.create).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when the caller is not the owner and lacks write_any', async () => {
      mockPrisma.secret.findUnique.mockResolvedValue(mockSecret as any);

      await expect(
        service.update(secretId, updateDto, otherUserId, []),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ============================================================================
  // rollback
  // ============================================================================

  describe('rollback', () => {
    const oldVersion = {
      ...mockVersion,
      id: 'version-old',
      version: 1,
      isCurrent: false,
    };

    beforeEach(() => {
      mockPrisma.secret.findUnique.mockResolvedValue(mockSecret as any);
      mockPrisma.secretVersion.findUnique.mockResolvedValue(oldVersion as any);
      mockPrisma.secretVersion.findFirst.mockResolvedValue({ version: 2 } as any);
      mockPrisma.secretVersion.updateMany.mockResolvedValue({ count: 2 } as any);
      mockPrisma.secretVersion.create.mockResolvedValue({
        ...mockVersion,
        id: 'version-new',
        version: 3,
      } as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      // findOne calls at the end of rollback
      mockPrisma.secret.findUnique
        .mockResolvedValueOnce(mockSecret as any) // auth check in rollback
        .mockResolvedValueOnce(mockSecret as any) // findOne auth check
        .mockResolvedValueOnce({
          ...mockSecret,
          versions: [mockVersion],
          attachments: [],
        } as any); // findOne detail
    });

    it('should decrypt the old version data and re-encrypt with a fresh IV', async () => {
      const perms = [PERMISSIONS.SECRETS_WRITE];
      await service.rollback(secretId, oldVersion.id, userId, perms);

      expect(mockCrypto.decrypt).toHaveBeenCalledWith(
        oldVersion.encryptedData,
        oldVersion.iv,
        oldVersion.authTag,
      );
      expect(mockCrypto.encrypt).toHaveBeenCalledWith(rawDataJson);
    });

    it('should unmark all existing versions before creating the new rollback version', async () => {
      const perms = [PERMISSIONS.SECRETS_WRITE];
      await service.rollback(secretId, oldVersion.id, userId, perms);

      expect(mockPrisma.secretVersion.updateMany).toHaveBeenCalledWith({
        where: { secretId },
        data: { isCurrent: false },
      });
    });

    it('should create a new version with an incremented number and isCurrent=true', async () => {
      const perms = [PERMISSIONS.SECRETS_WRITE];
      await service.rollback(secretId, oldVersion.id, userId, perms);

      expect(mockPrisma.secretVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            secretId,
            version: 3, // max (2) + 1
            isCurrent: true,
          }),
        }),
      );
    });

    it('should throw NotFoundException when the version does not exist', async () => {
      mockPrisma.secret.findUnique.mockResolvedValue(mockSecret as any);
      mockPrisma.secretVersion.findUnique.mockResolvedValue(null);

      await expect(
        service.rollback(secretId, 'nonexistent-version', userId, [PERMISSIONS.SECRETS_WRITE]),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when the version belongs to a different secret', async () => {
      const wrongSecret = { ...oldVersion, secretId: 'other-secret' };
      mockPrisma.secret.findUnique.mockResolvedValue(mockSecret as any);
      mockPrisma.secretVersion.findUnique.mockResolvedValue(wrongSecret as any);

      await expect(
        service.rollback(secretId, oldVersion.id, userId, [PERMISSIONS.SECRETS_WRITE]),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================================
  // remove
  // ============================================================================

  describe('remove', () => {
    beforeEach(() => {
      mockPrisma.secret.findUnique.mockResolvedValue(mockSecret as any);
      mockPrisma.secret.delete.mockResolvedValue(mockSecret as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);
    });

    it('should delete the secret by ID', async () => {
      const perms = [PERMISSIONS.SECRETS_DELETE];
      await service.remove(secretId, userId, perms);

      expect(mockPrisma.secret.delete).toHaveBeenCalledWith({ where: { id: secretId } });
    });

    it('should create an audit event after deletion', async () => {
      const perms = [PERMISSIONS.SECRETS_DELETE];
      await service.remove(secretId, userId, perms);

      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: userId,
          action: 'secret.delete',
          targetId: secretId,
        }),
      });
    });

    it('should throw NotFoundException when the secret does not exist', async () => {
      mockPrisma.secret.findUnique.mockResolvedValue(null);

      await expect(service.remove('nonexistent', userId, [PERMISSIONS.SECRETS_DELETE])).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when non-owner lacks delete_any permission', async () => {
      mockPrisma.secret.findUnique.mockResolvedValue(mockSecret as any);

      await expect(service.remove(secretId, otherUserId, [])).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ============================================================================
  // validateDataAgainstType (tested indirectly via create)
  // ============================================================================

  describe('validateDataAgainstType (via create)', () => {
    const ownerPerms = [PERMISSIONS.SECRETS_WRITE];

    beforeEach(() => {
      mockPrisma.secretType.findUnique.mockResolvedValue(mockSecretType as any);
      mockPrisma.secret.create.mockResolvedValue(mockSecret as any);
      mockPrisma.secretVersion.create.mockResolvedValue(mockVersion as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);
    });

    it('should throw BadRequestException when a required field is missing', async () => {
      const dto: CreateSecretDto = {
        name: 'Bad Secret',
        typeId,
        data: { username: 'alice' }, // password is missing
      } as CreateSecretDto;

      await expect(service.create(dto, userId, ownerPerms)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when a required field is empty', async () => {
      const dto: CreateSecretDto = {
        name: 'Bad Secret',
        typeId,
        data: { username: '', password: 'pass' },
      } as CreateSecretDto;

      await expect(service.create(dto, userId, ownerPerms)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when an unknown field is supplied', async () => {
      const dto: CreateSecretDto = {
        name: 'Bad Secret',
        typeId,
        data: { username: 'alice', password: 'pass', unknown_field: 'value' },
      } as CreateSecretDto;

      await expect(service.create(dto, userId, ownerPerms)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when a string field receives a non-string value', async () => {
      const dto: CreateSecretDto = {
        name: 'Bad Secret',
        typeId,
        data: { username: 123, password: 'pass' }, // username should be string
      } as unknown as CreateSecretDto;

      await expect(service.create(dto, userId, ownerPerms)).rejects.toThrow(BadRequestException);
    });

    it('should include field-level error details in the exception body', async () => {
      const dto: CreateSecretDto = {
        name: 'Bad Secret',
        typeId,
        data: {},
      } as CreateSecretDto;

      let caught: BadRequestException | undefined;
      try {
        await service.create(dto, userId, ownerPerms);
      } catch (err) {
        caught = err as BadRequestException;
      }

      expect(caught).toBeDefined();
      const response = caught!.getResponse() as { details: { errors: string[] } };
      expect(Array.isArray(response.details.errors)).toBe(true);
      expect(response.details.errors.length).toBeGreaterThan(0);
    });

    it('should succeed and not throw when all required fields are present and valid', async () => {
      const dto: CreateSecretDto = {
        name: 'Good Secret',
        typeId,
        data: { username: 'alice', password: 'hunter2' },
      } as CreateSecretDto;

      await expect(service.create(dto, userId, ownerPerms)).resolves.toBeDefined();
    });
  });

  // ============================================================================
  // findVersions
  // ============================================================================

  describe('findVersions', () => {
    it('should return versions ordered by version desc', async () => {
      mockPrisma.secret.findUnique.mockResolvedValue(mockSecret as any);
      mockPrisma.secretVersion.findMany.mockResolvedValue([mockVersion] as any);

      const result = await service.findVersions(secretId, userId, [PERMISSIONS.SECRETS_READ]);

      expect(mockPrisma.secretVersion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { secretId },
          orderBy: { version: 'desc' },
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('should throw ForbiddenException when non-owner lacks read_any permission', async () => {
      mockPrisma.secret.findUnique.mockResolvedValue(mockSecret as any);

      await expect(
        service.findVersions(secretId, otherUserId, []),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ============================================================================
  // findVersion (single)
  // ============================================================================

  describe('findVersion', () => {
    it('should return the version with decrypted data', async () => {
      mockPrisma.secret.findUnique.mockResolvedValue(mockSecret as any);
      mockPrisma.secretVersion.findUnique.mockResolvedValue(mockVersion as any);

      const result = await service.findVersion(
        secretId,
        versionId,
        userId,
        [PERMISSIONS.SECRETS_READ],
      );

      expect(mockCrypto.decrypt).toHaveBeenCalledWith(
        mockVersion.encryptedData,
        mockVersion.iv,
        mockVersion.authTag,
      );
      expect(result.values).toEqual(rawData);
    });

    it('should throw NotFoundException when the version does not exist', async () => {
      mockPrisma.secret.findUnique.mockResolvedValue(mockSecret as any);
      mockPrisma.secretVersion.findUnique.mockResolvedValue(null);

      await expect(
        service.findVersion(secretId, 'nonexistent', userId, [PERMISSIONS.SECRETS_READ]),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when the version belongs to a different secret', async () => {
      mockPrisma.secret.findUnique.mockResolvedValue(mockSecret as any);
      mockPrisma.secretVersion.findUnique.mockResolvedValue({
        ...mockVersion,
        secretId: 'other-secret',
      } as any);

      await expect(
        service.findVersion(secretId, versionId, userId, [PERMISSIONS.SECRETS_READ]),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
