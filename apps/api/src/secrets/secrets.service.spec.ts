import { Readable } from 'stream';

import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SecretsService } from './secrets.service';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/services/crypto.service';
import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import { createMockStorageProvider } from '../../test/mocks/storage-provider.mock';
import { STORAGE_PROVIDER, StorageProvider } from '../storage/providers';
import { PERMISSIONS } from '../common/constants/roles.constants';
import { CreateSecretDto } from './dto/create-secret.dto';
import { UpdateSecretDto } from './dto/update-secret.dto';
import { RenewSecretDto } from './dto/renew-secret.dto';
import { SecretListQueryDto } from './dto/secret-list-query.dto';
import { SYSTEM_SECRET_TYPES } from '../../prisma/system-secret-types';

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
  let mockStorage: jest.Mocked<StorageProvider>;
  let mockConfig: { get: jest.Mock };

  const userId = 'user-aaa';
  const otherUserId = 'user-bbb';
  const secretId = 'secret-111';
  const typeId = 'type-222';
  const versionId = 'version-333';
  const storageObjectId = 'object-444';
  const attachmentId = 'attachment-555';

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

  // `size` is intentionally a real BigInt — this is exactly what Prisma returns
  // and what Fastify's serializer cannot handle.
  const mockStorageObject = {
    id: storageObjectId,
    name: 'front.png',
    size: BigInt(2048),
    mimeType: 'image/png',
    storageKey: 'secrets/abc123.png',
    storageProvider: 's3',
    bucket: 'app-bucket',
    status: 'ready',
    s3UploadId: 'upload-xyz',
    metadata: null,
    uploadedById: userId,
    mediaFolderId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockAttachment = {
    id: attachmentId,
    secretId,
    secretVersionId: versionId,
    storageObjectId,
    role: 'card_front',
    label: null,
    createdAt: new Date(),
    storageObject: mockStorageObject,
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

    mockStorage = createMockStorageProvider();

    // Unset by default, so the service falls back to its built-in card image
    // size cap unless a test opts into an override.
    mockConfig = { get: jest.fn().mockReturnValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecretsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CryptoService, useValue: mockCrypto },
        { provide: STORAGE_PROVIDER, useValue: mockStorage },
        { provide: ConfigService, useValue: mockConfig },
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

    it('should expose currentVersionId (the row id, not the version number)', async () => {
      mockPrisma.secret.findUnique
        .mockResolvedValueOnce(mockSecret as any)
        .mockResolvedValueOnce(fullSecretDetail as any);

      const result = await service.findOne(secretId, userId, [PERMISSIONS.SECRETS_READ]);

      expect(result.currentVersionId).toBe(versionId);
      expect(result.currentVersion).toBe(1);
    });

    it('should set currentVersionId to null when there is no current version', async () => {
      mockPrisma.secret.findUnique
        .mockResolvedValueOnce(mockSecret as any)
        .mockResolvedValueOnce({ ...mockSecret, versions: [], attachments: [] } as any);

      const result = await service.findOne(secretId, userId, [PERMISSIONS.SECRETS_READ]);

      expect(result.currentVersionId).toBeNull();
      expect(result.values).toBeNull();
    });

    it('should serialize the attachment BigInt size as a string', async () => {
      // Fastify's serializer throws on a raw BigInt, and there is deliberately
      // no global BigInt.prototype.toJSON in this app.
      mockPrisma.secret.findUnique
        .mockResolvedValueOnce(mockSecret as any)
        .mockResolvedValueOnce({
          ...mockSecret,
          versions: [mockVersion],
          attachments: [mockAttachment],
        } as any);

      const result = await service.findOne(secretId, userId, [PERMISSIONS.SECRETS_READ]);

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].storageObject!.size).toBe('2048');
      expect(typeof result.attachments[0].storageObject!.size).toBe('string');
      expect(() => JSON.stringify(result.attachments)).not.toThrow();
    });

    it('should not leak internal storage columns on attachments', async () => {
      mockPrisma.secret.findUnique
        .mockResolvedValueOnce(mockSecret as any)
        .mockResolvedValueOnce({
          ...mockSecret,
          versions: [mockVersion],
          attachments: [mockAttachment],
        } as any);

      const result = await service.findOne(secretId, userId, [PERMISSIONS.SECRETS_READ]);

      expect(result.attachments[0].storageObject).not.toHaveProperty('storageKey');
      expect(result.attachments[0].storageObject).not.toHaveProperty('s3UploadId');
      expect(result.attachments[0].secretVersionId).toBe(versionId);
      expect(result.attachments[0].role).toBe('card_front');
    });
  });

  // ============================================================================
  // linkAttachment
  // ============================================================================

  describe('linkAttachment', () => {
    const attachType = { ...mockSecretType, allowAttachments: true };
    const attachSecret = { ...mockSecret, type: attachType };
    const writePerms = [PERMISSIONS.SECRETS_WRITE];

    beforeEach(() => {
      mockPrisma.secret.findUnique.mockResolvedValue(attachSecret as any);
      mockPrisma.storageObject.findUnique.mockResolvedValue(mockStorageObject as any);
      mockPrisma.secretVersion.findFirst.mockResolvedValue({ id: versionId } as any);
      mockPrisma.secretAttachment.create.mockResolvedValue(mockAttachment as any);
    });

    it('should resolve the current version and insert inside a single transaction', async () => {
      await service.linkAttachment(
        secretId,
        { storageObjectId: storageObjectId } as any,
        userId,
        writePerms,
      );

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      // The isCurrent lookup must happen inside the transaction, before insert.
      expect(mockPrisma.secretVersion.findFirst).toHaveBeenCalledWith({
        where: { secretId, isCurrent: true },
        select: { id: true },
      });
      const findFirstOrder = (mockPrisma.secretVersion.findFirst as jest.Mock).mock
        .invocationCallOrder[0];
      const createOrder = (mockPrisma.secretAttachment.create as jest.Mock).mock
        .invocationCallOrder[0];
      expect(findFirstOrder).toBeLessThan(createOrder);
    });

    it('should stamp the resolved secretVersionId on the attachment', async () => {
      await service.linkAttachment(
        secretId,
        { storageObjectId: storageObjectId } as any,
        userId,
        writePerms,
      );

      expect(mockPrisma.secretAttachment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            secretId,
            secretVersionId: versionId,
            storageObjectId,
          }),
        }),
      );
    });

    it('should pass an explicit role through to the create', async () => {
      await service.linkAttachment(
        secretId,
        { storageObjectId: storageObjectId, role: 'card_back' } as any,
        userId,
        writePerms,
      );

      const call = (mockPrisma.secretAttachment.create as jest.Mock).mock.calls[0][0];
      expect(call.data.role).toBe('card_back');
    });

    it('should leave role undefined (generic attachment) when omitted', async () => {
      await service.linkAttachment(
        secretId,
        { storageObjectId: storageObjectId } as any,
        userId,
        writePerms,
      );

      const call = (mockPrisma.secretAttachment.create as jest.Mock).mock.calls[0][0];
      expect(call.data.role).toBeUndefined();
    });

    it('should stringify the BigInt size on the returned attachment', async () => {
      const result = await service.linkAttachment(
        secretId,
        { storageObjectId: storageObjectId } as any,
        userId,
        writePerms,
      );

      expect(result.storageObject!.size).toBe('2048');
      expect(() => JSON.stringify(result)).not.toThrow();
    });

    it('should throw BadRequestException when the type does not allow attachments', async () => {
      mockPrisma.secret.findUnique.mockResolvedValue(mockSecret as any); // allowAttachments: false

      await expect(
        service.linkAttachment(
          secretId,
          { storageObjectId: storageObjectId } as any,
          userId,
          writePerms,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when the storage object does not exist', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue(null);

      await expect(
        service.linkAttachment(
          secretId,
          { storageObjectId: storageObjectId } as any,
          userId,
          writePerms,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when the storage object belongs to someone else', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue({
        ...mockStorageObject,
        uploadedById: otherUserId,
      } as any);

      await expect(
        service.linkAttachment(
          secretId,
          { storageObjectId: storageObjectId } as any,
          userId,
          writePerms,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when the secret has no current version', async () => {
      mockPrisma.secretVersion.findFirst.mockResolvedValue(null);

      await expect(
        service.linkAttachment(
          secretId,
          { storageObjectId: storageObjectId } as any,
          userId,
          writePerms,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should map a P2002 on [secretVersionId, role] to a 409 naming the side', async () => {
      mockPrisma.secretAttachment.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
          meta: { target: ['secret_version_id', 'role'] },
        }),
      );

      let caught: ConflictException | undefined;
      try {
        await service.linkAttachment(
          secretId,
          { storageObjectId: storageObjectId, role: 'card_front' } as any,
          userId,
          writePerms,
        );
      } catch (err) {
        caught = err as ConflictException;
      }

      expect(caught).toBeInstanceOf(ConflictException);
      expect(caught!.message).toContain('front image');
    });

    it('should map a P2002 on [secretVersionId, storageObjectId] to a duplicate-file 409', async () => {
      mockPrisma.secretAttachment.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
          meta: { target: ['secret_version_id', 'storage_object_id'] },
        }),
      );

      let caught: ConflictException | undefined;
      try {
        await service.linkAttachment(
          secretId,
          { storageObjectId: storageObjectId } as any,
          userId,
          writePerms,
        );
      } catch (err) {
        caught = err as ConflictException;
      }

      expect(caught).toBeInstanceOf(ConflictException);
      expect(caught!.message).toContain('already attached');
    });

    it('should rethrow non-P2002 errors untouched', async () => {
      mockPrisma.secretAttachment.create.mockRejectedValue(
        Object.assign(new Error('connection reset'), { code: 'P1001' }),
      );

      await expect(
        service.linkAttachment(
          secretId,
          { storageObjectId: storageObjectId } as any,
          userId,
          writePerms,
        ),
      ).rejects.toThrow('connection reset');
    });

    // ------------------------------------------------------------------------
    // Card image type/size constraints (issue #25)
    // ------------------------------------------------------------------------

    describe('card image constraints', () => {
      const MB = 1024 * 1024;

      /** A storage object with a specific mime type and RECORDED size. */
      function objectWith(overrides: {
        mimeType?: string;
        size?: bigint;
      }): Record<string, unknown> {
        return { ...mockStorageObject, ...overrides };
      }

      /** A readable that yields exactly `bytes` bytes in 64 KB chunks. */
      function blobOf(bytes: number): Readable {
        const chunkSize = 64 * 1024;
        let remaining = bytes;
        return new Readable({
          read() {
            if (remaining <= 0) {
              this.push(null);
              return;
            }
            const next = Math.min(chunkSize, remaining);
            remaining -= next;
            this.push(Buffer.alloc(next));
          },
        });
      }

      it.each([
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/heic',
        'image/heif',
      ])('should accept %s as a card image', async (mimeType) => {
        mockPrisma.storageObject.findUnique.mockResolvedValue(
          objectWith({ mimeType, size: BigInt(2048) }) as any,
        );

        await expect(
          service.linkAttachment(
            secretId,
            { storageObjectId, role: 'card_front' } as any,
            userId,
            writePerms,
          ),
        ).resolves.toBeDefined();

        expect(mockPrisma.secretAttachment.create).toHaveBeenCalled();
      });

      it('should accept a mime type carrying parameters and odd casing', async () => {
        mockPrisma.storageObject.findUnique.mockResolvedValue(
          objectWith({ mimeType: 'Image/JPEG; charset=binary', size: BigInt(2048) }) as any,
        );

        await expect(
          service.linkAttachment(
            secretId,
            { storageObjectId, role: 'card_front' } as any,
            userId,
            writePerms,
          ),
        ).resolves.toBeDefined();
      });

      it('should reject a non-image mime type, naming the type and the accepted set', async () => {
        mockPrisma.storageObject.findUnique.mockResolvedValue(
          objectWith({ mimeType: 'application/pdf', size: BigInt(2048) }) as any,
        );

        let caught: BadRequestException | undefined;
        try {
          await service.linkAttachment(
            secretId,
            { storageObjectId, role: 'card_front' } as any,
            userId,
            writePerms,
          );
        } catch (err) {
          caught = err as BadRequestException;
        }

        expect(caught).toBeInstanceOf(BadRequestException);
        expect(caught!.message).toContain('application/pdf');
        expect(caught!.message).toContain('image/jpeg');
        expect(mockPrisma.secretAttachment.create).not.toHaveBeenCalled();
      });

      it('should reject a disallowed image subtype (image/svg+xml)', async () => {
        mockPrisma.storageObject.findUnique.mockResolvedValue(
          objectWith({ mimeType: 'image/svg+xml', size: BigInt(2048) }) as any,
        );

        await expect(
          service.linkAttachment(
            secretId,
            { storageObjectId, role: 'card_back' } as any,
            userId,
            writePerms,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('should NOT apply the constraints to a generic (roleless) attachment', async () => {
        mockPrisma.storageObject.findUnique.mockResolvedValue(
          objectWith({ mimeType: 'application/pdf', size: BigInt(500 * MB) }) as any,
        );

        await expect(
          service.linkAttachment(
            secretId,
            { storageObjectId } as any,
            userId,
            writePerms,
          ),
        ).resolves.toBeDefined();
      });

      it('should reject an oversize card image, stating the limit', async () => {
        mockPrisma.storageObject.findUnique.mockResolvedValue(
          objectWith({ mimeType: 'image/jpeg', size: BigInt(6 * MB) }) as any,
        );

        let caught: BadRequestException | undefined;
        try {
          await service.linkAttachment(
            secretId,
            { storageObjectId, role: 'card_front' } as any,
            userId,
            writePerms,
          );
        } catch (err) {
          caught = err as BadRequestException;
        }

        expect(caught).toBeInstanceOf(BadRequestException);
        expect(caught!.message).toContain(String(5 * MB));
        expect(mockPrisma.secretAttachment.create).not.toHaveBeenCalled();
      });

      it('should not read from storage when the recorded size is trustworthy', async () => {
        mockPrisma.storageObject.findUnique.mockResolvedValue(
          objectWith({ mimeType: 'image/jpeg', size: BigInt(2048) }) as any,
        );

        await service.linkAttachment(
          secretId,
          { storageObjectId, role: 'card_front' } as any,
          userId,
          writePerms,
        );

        expect(mockStorage.download).not.toHaveBeenCalled();
      });

      // ---- size === 0 ("unknown", because simpleUpload records 0) ----------

      it('should measure the real size from storage when the recorded size is 0', async () => {
        mockPrisma.storageObject.findUnique.mockResolvedValue(
          objectWith({ mimeType: 'image/jpeg', size: BigInt(0) }) as any,
        );
        mockStorage.download.mockResolvedValue(blobOf(2 * MB));

        await expect(
          service.linkAttachment(
            secretId,
            { storageObjectId, role: 'card_front' } as any,
            userId,
            writePerms,
          ),
        ).resolves.toBeDefined();

        expect(mockStorage.download).toHaveBeenCalledWith(
          mockStorageObject.storageKey,
        );
        expect(mockPrisma.secretAttachment.create).toHaveBeenCalled();
      });

      it('should reject an oversize object whose recorded size is 0', async () => {
        mockPrisma.storageObject.findUnique.mockResolvedValue(
          objectWith({ mimeType: 'image/jpeg', size: BigInt(0) }) as any,
        );
        mockStorage.download.mockResolvedValue(blobOf(8 * MB));

        await expect(
          service.linkAttachment(
            secretId,
            { storageObjectId, role: 'card_front' } as any,
            userId,
            writePerms,
          ),
        ).rejects.toThrow(BadRequestException);

        expect(mockPrisma.secretAttachment.create).not.toHaveBeenCalled();
      });

      it('should stop reading once past the limit instead of draining the object', async () => {
        mockPrisma.storageObject.findUnique.mockResolvedValue(
          objectWith({ mimeType: 'image/jpeg', size: BigInt(0) }) as any,
        );

        // 100 x 1 MB. If the limit check drained the whole object it would pull
        // all 100; it must stop one chunk past the 5 MB cap.
        let chunksPulled = 0;
        let remaining = 100;
        const stream = new Readable({
          read() {
            if (remaining <= 0) {
              this.push(null);
              return;
            }
            remaining -= 1;
            chunksPulled += 1;
            this.push(Buffer.alloc(MB));
          },
        });
        mockStorage.download.mockResolvedValue(stream);

        await expect(
          service.linkAttachment(
            secretId,
            { storageObjectId, role: 'card_front' } as any,
            userId,
            writePerms,
          ),
        ).rejects.toThrow(BadRequestException);

        expect(chunksPulled).toBeLessThan(10);
        expect(stream.destroyed).toBe(true);
      });

      it('should fail closed when the object cannot be read back from storage', async () => {
        mockPrisma.storageObject.findUnique.mockResolvedValue(
          objectWith({ mimeType: 'image/jpeg', size: BigInt(0) }) as any,
        );
        mockStorage.download.mockRejectedValue(new Error('NoSuchKey'));

        await expect(
          service.linkAttachment(
            secretId,
            { storageObjectId, role: 'card_front' } as any,
            userId,
            writePerms,
          ),
        ).rejects.toThrow(BadRequestException);

        expect(mockPrisma.secretAttachment.create).not.toHaveBeenCalled();
      });

      it('should fail closed when the read-back stream errors mid-flight', async () => {
        mockPrisma.storageObject.findUnique.mockResolvedValue(
          objectWith({ mimeType: 'image/jpeg', size: BigInt(0) }) as any,
        );
        const stream = new Readable({
          read() {
            this.destroy(new Error('connection reset'));
          },
        });
        mockStorage.download.mockResolvedValue(stream);

        await expect(
          service.linkAttachment(
            secretId,
            { storageObjectId, role: 'card_front' } as any,
            userId,
            writePerms,
          ),
        ).rejects.toThrow(BadRequestException);

        expect(mockPrisma.secretAttachment.create).not.toHaveBeenCalled();
      });

      // ---- operator-tunable limit ------------------------------------------

      it('should honour a CARD_IMAGE_MAX_BYTES override', async () => {
        mockConfig.get.mockImplementation((key: string) =>
          key === 'CARD_IMAGE_MAX_BYTES' ? '1024' : undefined,
        );
        mockPrisma.storageObject.findUnique.mockResolvedValue(
          objectWith({ mimeType: 'image/jpeg', size: BigInt(2048) }) as any,
        );

        let caught: BadRequestException | undefined;
        try {
          await service.linkAttachment(
            secretId,
            { storageObjectId, role: 'card_front' } as any,
            userId,
            writePerms,
          );
        } catch (err) {
          caught = err as BadRequestException;
        }

        expect(caught).toBeInstanceOf(BadRequestException);
        expect(caught!.message).toContain('1024');
      });

      it('should ignore an unparseable CARD_IMAGE_MAX_BYTES and keep the default', async () => {
        mockConfig.get.mockImplementation((key: string) =>
          key === 'CARD_IMAGE_MAX_BYTES' ? '5MB' : undefined,
        );
        mockPrisma.storageObject.findUnique.mockResolvedValue(
          objectWith({ mimeType: 'image/jpeg', size: BigInt(6 * MB) }) as any,
        );

        // NaN must not disable the check: 6 MB is still over the 5 MB default.
        await expect(
          service.linkAttachment(
            secretId,
            { storageObjectId, role: 'card_front' } as any,
            userId,
            writePerms,
          ),
        ).rejects.toThrow(BadRequestException);
      });
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
  // renew  (issue #30)
  // ============================================================================

  describe('renew', () => {
    const writePerms = [PERMISSIONS.SECRETS_WRITE];
    const newVersionId = 'version-renewed';

    // A Card type: attachments allowed, and the fields a reissued card changes.
    const cardTypeId = 'type-card';
    const cardType = {
      ...mockSecretType,
      id: cardTypeId,
      name: 'Card',
      fields: [
        { name: 'number', label: 'Number', type: 'string', required: true, sensitive: true },
        { name: 'holder', label: 'Holder', type: 'string', required: true, sensitive: false },
        { name: 'expiry', label: 'Expiry', type: 'string', required: false, sensitive: false },
      ],
      allowAttachments: true,
    };

    const cardSecret = {
      ...mockSecret,
      typeId: cardTypeId,
      type: cardType,
    };

    // The card that is being replaced: both faces plus an unrelated document.
    const oldFront = {
      storageObjectId: 'object-old-front',
      role: 'card_front',
      label: 'Old front',
    };
    const oldBack = {
      storageObjectId: 'object-old-back',
      role: 'card_back',
      label: 'Old back',
    };
    const oldDoc = {
      storageObjectId: 'object-doc',
      role: null,
      label: 'Terms.pdf',
    };

    const newFrontObject = {
      ...mockStorageObject,
      id: 'object-new-front',
      name: 'new-front.png',
      mimeType: 'image/png',
      size: BigInt(2048),
      uploadedById: userId,
    };

    const newCardData = {
      number: '4111111111119999',
      holder: 'O. MARIN',
      expiry: '2031-04',
    };

    // Only the front is re-photographed. card_back and the document must
    // survive; the OLD front must not.
    const renewDto = {
      data: newCardData,
      attachments: [
        { storageObjectId: newFrontObject.id, role: 'card_front' as const },
      ],
    } as RenewSecretDto;

    function primeHappyPath() {
      // Serves the auth check, findOne's auth check and findOne's detail read.
      mockPrisma.secret.findUnique.mockResolvedValue({
        ...cardSecret,
        versions: [{ ...mockVersion, id: newVersionId, version: 2 }],
        attachments: [],
      } as any);

      mockPrisma.storageObject.findUnique.mockResolvedValue(newFrontObject as any);

      // 1st findFirst = max version lookup, 2nd = current-version lookup
      mockPrisma.secretVersion.findFirst
        .mockResolvedValueOnce({ version: 1 } as any)
        .mockResolvedValueOnce({ id: versionId } as any);
      mockPrisma.secretVersion.updateMany.mockResolvedValue({ count: 1 } as any);
      mockPrisma.secretVersion.create.mockResolvedValue({
        ...mockVersion,
        id: newVersionId,
        version: 2,
      } as any);

      mockPrisma.secretAttachment.findMany.mockResolvedValue([
        oldFront,
        oldBack,
        oldDoc,
      ] as any);
      mockPrisma.secretAttachment.createMany.mockResolvedValue({ count: 2 } as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);
    }

    /** Every row written by every createMany call, flattened. */
    function writtenRows(): any[] {
      return (mockPrisma.secretAttachment.createMany as jest.Mock).mock.calls.flatMap(
        (call) => call[0].data,
      );
    }

    beforeEach(primeHappyPath);

    // -------------------------------------------------------------------------
    // The new version
    // -------------------------------------------------------------------------

    it('should create v_n+1 carrying the NEW card data', async () => {
      await service.renew(secretId, renewDto, userId, writePerms);

      expect(mockCrypto.encrypt).toHaveBeenCalledWith(JSON.stringify(newCardData));
      expect(mockPrisma.secretVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            secretId,
            version: 2, // max (1) + 1
            isCurrent: true,
            encryptedData: encryptedPayload.ciphertext,
          }),
        }),
      );
      expect(mockPrisma.secretVersion.updateMany).toHaveBeenCalledWith({
        where: { secretId },
        data: { isCurrent: false },
      });
    });

    it('should validate the payload against the type exactly as update does', async () => {
      // `number` is required on the Card type.
      await expect(
        service.renew(
          secretId,
          { data: { holder: 'O. MARIN' } } as RenewSecretDto,
          userId,
          writePerms,
        ),
      ).rejects.toThrow(BadRequestException);

      // Nothing was minted: validation runs before the transaction.
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should reject an unknown field rather than silently storing it', async () => {
      await expect(
        service.renew(
          secretId,
          { data: { ...newCardData, cvv: '123' } } as RenewSecretDto,
          userId,
          writePerms,
        ),
      ).rejects.toThrow(/Secret data validation failed|Unknown field/);
    });

    // -------------------------------------------------------------------------
    // Selective carry-forward
    // -------------------------------------------------------------------------

    it('should carry forward the roles that were NOT replaced', async () => {
      await service.renew(secretId, renewDto, userId, writePerms);

      const carried = (mockPrisma.secretAttachment.createMany as jest.Mock).mock
        .calls[0][0].data;

      expect(carried).toHaveLength(2);
      expect(carried).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            storageObjectId: 'object-old-back',
            role: 'card_back',
          }),
          // The role-less document is not a card face and must survive.
          expect.objectContaining({ storageObjectId: 'object-doc', role: null }),
        ]),
      );
    });

    it('should NOT carry forward the replaced role', async () => {
      await service.renew(secretId, renewDto, userId, writePerms);

      // The dead card's front must never land on the new version — that is the
      // exact row that would collide on @@unique([secretVersionId, role]).
      expect(writtenRows()).not.toContainEqual(
        expect.objectContaining({ storageObjectId: 'object-old-front' }),
      );
      expect(
        writtenRows().filter((r) => r.role === 'card_front'),
      ).toHaveLength(1);
    });

    it('should insert the replacement against the NEW version id', async () => {
      await service.renew(secretId, renewDto, userId, writePerms);

      const replacements = (mockPrisma.secretAttachment.createMany as jest.Mock)
        .mock.calls[1][0].data;

      expect(replacements).toEqual([
        expect.objectContaining({
          secretId,
          secretVersionId: newVersionId,
          storageObjectId: 'object-new-front',
          role: 'card_front',
        }),
      ]);
      // Both carried and replacement rows land on v_n+1, never anywhere else.
      expect(writtenRows().every((r) => r.secretVersionId === newVersionId)).toBe(
        true,
      );
    });

    it('should carry EVERYTHING forward when no attachments are supplied', async () => {
      await service.renew(
        secretId,
        { data: newCardData } as RenewSecretDto,
        userId,
        writePerms,
      );

      const carried = (mockPrisma.secretAttachment.createMany as jest.Mock).mock
        .calls[0][0].data;
      expect(carried).toHaveLength(3);
      expect(mockPrisma.secretAttachment.createMany).toHaveBeenCalledTimes(1);
    });

    it('should hold back a re-supplied object even under a different role', async () => {
      // The user attaches the file that was previously the BACK as the new
      // front. Carrying the old row forward too would trip
      // @@unique([secretVersionId, storageObjectId]).
      mockPrisma.storageObject.findUnique.mockResolvedValue({
        ...newFrontObject,
        id: 'object-old-back',
      } as any);

      await service.renew(
        secretId,
        {
          data: newCardData,
          attachments: [
            { storageObjectId: 'object-old-back', role: 'card_front' as const },
          ],
        } as RenewSecretDto,
        userId,
        writePerms,
      );

      const rows = writtenRows().filter(
        (r) => r.storageObjectId === 'object-old-back',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].role).toBe('card_front');
    });

    // -------------------------------------------------------------------------
    // The previous version is left alone
    // -------------------------------------------------------------------------

    it('should leave the previous version its own attachment set', async () => {
      await service.renew(secretId, renewDto, userId, writePerms);

      // The old version's rows are only ever READ. Nothing deletes or re-points
      // them, which is what keeps the dead card's images readable from history.
      expect(mockPrisma.secretAttachment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { secretVersionId: versionId } }),
      );
      expect(mockPrisma.secretAttachment.delete).not.toHaveBeenCalled();
      expect(mockPrisma.secretAttachment.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.secretAttachment.update).not.toHaveBeenCalled();
      expect(mockPrisma.secretAttachment.updateMany).not.toHaveBeenCalled();

      // And no write targets the old version id.
      expect(writtenRows().some((r) => r.secretVersionId === versionId)).toBe(false);
    });

    it('should resolve the carry-forward source before clearing isCurrent', async () => {
      await service.renew(secretId, renewDto, userId, writePerms);

      const lookupOrder = (mockPrisma.secretVersion.findFirst as jest.Mock).mock
        .invocationCallOrder[1];
      const updateManyOrder = (mockPrisma.secretVersion.updateMany as jest.Mock)
        .mock.invocationCallOrder[0];
      expect(lookupOrder).toBeLessThan(updateManyOrder);
    });

    // -------------------------------------------------------------------------
    // Storage object validation (must match linkAttachment)
    // -------------------------------------------------------------------------

    it('should throw NotFoundException when a supplied storage object does not exist', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue(null);

      await expect(
        service.renew(secretId, renewDto, userId, writePerms),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when the object belongs to someone else', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue({
        ...newFrontObject,
        uploadedById: otherUserId,
      } as any);

      await expect(
        service.renew(secretId, renewDto, userId, writePerms),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should let a holder of write_any use an object they did not upload', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue({
        ...newFrontObject,
        uploadedById: otherUserId,
      } as any);

      await expect(
        service.renew(secretId, renewDto, userId, [
          PERMISSIONS.SECRETS_WRITE,
          PERMISSIONS.SECRETS_WRITE_ANY,
        ]),
      ).resolves.toBeDefined();
    });

    it('should reject attachments on a type that does not allow them', async () => {
      mockPrisma.secret.findUnique.mockResolvedValue({
        ...mockSecret, // allowAttachments: false
        versions: [mockVersion],
        attachments: [],
      } as any);

      await expect(
        service.renew(
          secretId,
          {
            data: rawData,
            attachments: [
              { storageObjectId: newFrontObject.id, role: 'card_front' as const },
            ],
          } as RenewSecretDto,
          userId,
          writePerms,
        ),
      ).rejects.toThrow('This secret type does not allow attachments');
    });

    it('should reject a payload listing the same role twice', async () => {
      await expect(
        service.renew(
          secretId,
          {
            data: newCardData,
            attachments: [
              { storageObjectId: 'object-a', role: 'card_front' as const },
              { storageObjectId: 'object-b', role: 'card_front' as const },
            ],
          } as RenewSecretDto,
          userId,
          writePerms,
        ),
      ).rejects.toThrow(BadRequestException);

      // Rejected before a single storage lookup is paid for.
      expect(mockPrisma.storageObject.findUnique).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // Card image constraints (a renewal must not bypass linkAttachment's gate)
    // -------------------------------------------------------------------------

    it('should reject a non-image card image', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue({
        ...newFrontObject,
        mimeType: 'application/pdf',
      } as any);

      await expect(
        service.renew(secretId, renewDto, userId, writePerms),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.renew(secretId, renewDto, userId, writePerms),
      ).rejects.toThrow(/application\/pdf/);

      // No version was minted for a rejected image.
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.secretVersion.create).not.toHaveBeenCalled();
    });

    it('should reject an oversize card image', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue({
        ...newFrontObject,
        size: BigInt(6 * 1024 * 1024), // over the 5 MB default
      } as any);

      await expect(
        service.renew(secretId, renewDto, userId, writePerms),
      ).rejects.toThrow(/5242880 bytes or smaller/);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should measure an object whose recorded size is 0, exactly as linking does', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue({
        ...newFrontObject,
        size: BigInt(0),
      } as any);
      mockStorage.download.mockResolvedValue(
        Readable.from([Buffer.alloc(6 * 1024 * 1024)]),
      );

      await expect(
        service.renew(secretId, renewDto, userId, writePerms),
      ).rejects.toThrow(BadRequestException);
      expect(mockStorage.download).toHaveBeenCalledWith(newFrontObject.storageKey);
    });

    it('should NOT apply the image gate to a role-less addition', async () => {
      mockPrisma.storageObject.findUnique.mockResolvedValue({
        ...newFrontObject,
        mimeType: 'application/pdf',
      } as any);

      await expect(
        service.renew(
          secretId,
          {
            data: newCardData,
            attachments: [
              { storageObjectId: newFrontObject.id, label: 'Terms.pdf' },
            ],
          } as RenewSecretDto,
          userId,
          writePerms,
        ),
      ).resolves.toBeDefined();
    });

    // -------------------------------------------------------------------------
    // Atomicity
    // -------------------------------------------------------------------------

    it('should roll the whole renewal back when the replacement insert fails', async () => {
      let txDepth = 0;
      const depthAt: Record<string, number> = {};

      (mockPrisma.$transaction as jest.Mock).mockImplementation(
        async (arg: unknown) => {
          if (typeof arg !== 'function') {
            return arg;
          }
          txDepth += 1;
          try {
            return await (arg as (tx: unknown) => Promise<unknown>)(mockPrisma);
          } finally {
            txDepth -= 1;
          }
        },
      );

      (mockPrisma.secretVersion.create as jest.Mock).mockImplementation(async () => {
        depthAt.versionCreate = txDepth;
        return { ...mockVersion, id: newVersionId, version: 2 };
      });

      const p2002 = Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: ['secret_version_id', 'role'] },
      });

      (mockPrisma.secretAttachment.createMany as jest.Mock)
        // carry-forward succeeds
        .mockImplementationOnce(async () => ({ count: 2 }))
        // replacement insert blows up
        .mockImplementationOnce(async () => {
          depthAt.replacementInsert = txDepth;
          throw p2002;
        });

      await expect(
        service.renew(secretId, renewDto, userId, writePerms),
      ).rejects.toThrow(ConflictException);

      // Both the version bump and the failing insert ran inside the SAME open
      // transaction, so Postgres discards the version, the carried rows and the
      // partial replacement together. Nothing half-renewed is ever visible.
      expect(depthAt.versionCreate).toBe(1);
      expect(depthAt.replacementInsert).toBe(1);

      // And nothing was recorded as having happened.
      expect(mockPrisma.auditEvent.create).not.toHaveBeenCalled();
    });

    it('should surface a non-P2002 failure untouched', async () => {
      const boom = new Error('connection reset');
      (mockPrisma.secretAttachment.createMany as jest.Mock)
        .mockResolvedValueOnce({ count: 2 } as any)
        .mockRejectedValueOnce(boom);

      await expect(
        service.renew(secretId, renewDto, userId, writePerms),
      ).rejects.toThrow(boom);
      expect(mockPrisma.auditEvent.create).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // Audit
    // -------------------------------------------------------------------------

    it('should audit under a distinct action, not secret.update', async () => {
      await service.renew(secretId, renewDto, userId, writePerms);

      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: userId,
          action: 'secret.renew',
          targetType: 'secret',
          targetId: secretId,
        }),
      });
      expect(mockPrisma.auditEvent.create).not.toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'secret.update' }),
      });
    });

    it('should record an AI-assisted extraction as such', async () => {
      await service.renew(
        secretId,
        { ...renewDto, aiAssisted: true } as RenewSecretDto,
        userId,
        writePerms,
      );

      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          meta: expect.objectContaining({ extractionMethod: 'ai_assisted' }),
        }),
      });
    });

    it('should default to a manual extraction when the flag is absent', async () => {
      await service.renew(secretId, renewDto, userId, writePerms);

      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          meta: expect.objectContaining({ extractionMethod: 'manual' }),
        }),
      });
    });

    it('should record what moved without recording any card value', async () => {
      await service.renew(
        secretId,
        { ...renewDto, aiAssisted: true } as RenewSecretDto,
        userId,
        writePerms,
      );

      const meta = (mockPrisma.auditEvent.create as jest.Mock).mock.calls[0][0].data
        .meta;

      expect(meta).toEqual(
        expect.objectContaining({
          fromVersionId: versionId,
          version: 2,
          carriedAttachments: 2,
          replacedAttachments: 1,
          replacedRoles: ['card_front'],
        }),
      );

      // The audit trail is readable by support staff and is not encrypted the
      // way a SecretVersion is. No card number, holder or expiry may appear —
      // neither as a value nor as a field name.
      const serialized = JSON.stringify(meta);
      expect(serialized).not.toContain(newCardData.number);
      expect(serialized).not.toContain(newCardData.holder);
      expect(serialized).not.toContain(newCardData.expiry);
      expect(serialized).not.toContain('number');
      expect(serialized).not.toContain('holder');
      expect(serialized).not.toContain('expiry');
    });

    // -------------------------------------------------------------------------
    // Authorization
    // -------------------------------------------------------------------------

    it('should throw ForbiddenException when a non-owner lacks write_any', async () => {
      await expect(
        service.renew(secretId, renewDto, otherUserId, [PERMISSIONS.SECRETS_WRITE]),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow a non-owner holding the _any escalation to renew', async () => {
      // read_any is needed alongside write_any because the response is a full
      // read of the secret — the same pairing update() and rollback() require.
      await expect(
        service.renew(secretId, renewDto, otherUserId, [
          PERMISSIONS.SECRETS_WRITE,
          PERMISSIONS.SECRETS_WRITE_ANY,
          PERMISSIONS.SECRETS_READ,
          PERMISSIONS.SECRETS_READ_ANY,
        ]),
      ).resolves.toBeDefined();
    });

    it('should still mint the new version for an admin acting under write_any', async () => {
      await service.renew(secretId, renewDto, otherUserId, [
        PERMISSIONS.SECRETS_WRITE,
        PERMISSIONS.SECRETS_WRITE_ANY,
        PERMISSIONS.SECRETS_READ,
        PERMISSIONS.SECRETS_READ_ANY,
      ]);

      expect(mockPrisma.secretVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            version: 2,
            // The version is attributed to whoever performed the renewal, not
            // to the secret's owner.
            createdById: otherUserId,
          }),
        }),
      );
    });

    it('should throw NotFoundException when the secret does not exist', async () => {
      mockPrisma.secret.findUnique.mockResolvedValue(null);

      await expect(
        service.renew(secretId, renewDto, userId, writePerms),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================================
  // rollback after renew  (issue #30 — the reason renewal keeps history intact)
  // ============================================================================

  describe('rollback after a renewal', () => {
    const writePerms = [PERMISSIONS.SECRETS_WRITE];

    // v1 = the ORIGINAL card. Its own field values and its own images.
    const originalVersionId = 'version-original';
    const originalVersion = {
      ...mockVersion,
      id: originalVersionId,
      version: 1,
      isCurrent: false,
      encryptedData: 'original-ciphertext==',
      iv: 'original-iv==',
      authTag: 'original-tag==',
    };

    // v1's attachments — the photographs of the card that was replaced.
    const originalAttachments = [
      {
        storageObjectId: 'object-original-front',
        role: 'card_front',
        label: 'Original front',
      },
      {
        storageObjectId: 'object-original-back',
        role: 'card_back',
        label: 'Original back',
      },
    ];

    const rolledBackVersionId = 'version-rolled-back';

    beforeEach(() => {
      mockPrisma.secret.findUnique.mockResolvedValue({
        ...mockSecret,
        versions: [{ ...mockVersion, id: rolledBackVersionId, version: 3 }],
        attachments: [],
      } as any);
      mockPrisma.secretVersion.findUnique.mockResolvedValue(originalVersion as any);
      // v2 (the renewal) is the highest existing version.
      mockPrisma.secretVersion.findFirst.mockResolvedValue({ version: 2 } as any);
      mockPrisma.secretVersion.updateMany.mockResolvedValue({ count: 2 } as any);
      mockPrisma.secretVersion.create.mockResolvedValue({
        ...mockVersion,
        id: rolledBackVersionId,
        version: 3,
      } as any);
      mockPrisma.secretAttachment.findMany.mockResolvedValue(
        originalAttachments as any,
      );
      mockPrisma.secretAttachment.createMany.mockResolvedValue({ count: 2 } as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);
    });

    it('should restore the original version FIELD data', async () => {
      await service.rollback(secretId, originalVersionId, userId, writePerms);

      // Decrypted from v1 specifically — not from the renewed v2.
      expect(mockCrypto.decrypt).toHaveBeenCalledWith(
        originalVersion.encryptedData,
        originalVersion.iv,
        originalVersion.authTag,
      );
      expect(mockCrypto.encrypt).toHaveBeenCalledWith(rawDataJson);
      expect(mockPrisma.secretVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: 3, isCurrent: true }),
        }),
      );
    });

    it('should restore the original version IMAGES alongside the fields', async () => {
      await service.rollback(secretId, originalVersionId, userId, writePerms);

      // The attachment source is v1, the version being rolled back TO. Reading
      // the current version here would pair the original card's number with the
      // renewed card's photographs.
      expect(mockPrisma.secretAttachment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { secretVersionId: originalVersionId } }),
      );

      const rows = (mockPrisma.secretAttachment.createMany as jest.Mock).mock
        .calls[0][0].data;

      expect(rows).toHaveLength(2);
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            secretVersionId: rolledBackVersionId,
            storageObjectId: 'object-original-front',
            role: 'card_front',
          }),
          expect.objectContaining({
            secretVersionId: rolledBackVersionId,
            storageObjectId: 'object-original-back',
            role: 'card_back',
          }),
        ]),
      );
    });

    it('should not drag the renewed version files along', async () => {
      await service.rollback(secretId, originalVersionId, userId, writePerms);

      const rows = (mockPrisma.secretAttachment.createMany as jest.Mock).mock
        .calls[0][0].data;

      expect(rows.map((r: any) => r.storageObjectId)).not.toContain(
        'object-new-front',
      );
      expect(mockPrisma.secretVersion.findFirst).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { secretId, isCurrent: true } }),
      );
    });

    it('should report the restored attachment count on the audit event', async () => {
      await service.rollback(secretId, originalVersionId, userId, writePerms);

      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'secret.rollback',
          meta: expect.objectContaining({
            fromVersion: 1,
            carriedAttachments: 2,
          }),
        }),
      });
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

    describe('select field type', () => {
      const selectSecretType = {
        ...mockSecretType,
        fields: [
          {
            name: 'card_network',
            label: 'Card Network',
            type: 'select',
            required: false,
            sensitive: false,
            options: ['Visa', 'Mastercard'],
          },
        ],
      };

      it('should accept a select value present in options', async () => {
        mockPrisma.secretType.findUnique.mockResolvedValue(selectSecretType as any);
        const dto: CreateSecretDto = {
          name: 'Good Card',
          typeId,
          data: { card_network: 'Visa' },
        } as CreateSecretDto;

        await expect(service.create(dto, userId, ownerPerms)).resolves.toBeDefined();
      });

      it('should reject a select value not present in options, naming the allowed values', async () => {
        mockPrisma.secretType.findUnique.mockResolvedValue(selectSecretType as any);
        const dto: CreateSecretDto = {
          name: 'Bad Card',
          typeId,
          data: { card_network: 'Bitcoin' },
        } as CreateSecretDto;

        let caught: BadRequestException | undefined;
        try {
          await service.create(dto, userId, ownerPerms);
        } catch (err) {
          caught = err as BadRequestException;
        }

        expect(caught).toBeInstanceOf(BadRequestException);
        const response = caught!.getResponse() as { details: { errors: string[] } };
        expect(response.details.errors.join(' ')).toContain('Visa, Mastercard');
      });

      it('should accept any value when a select field has no options (defensive guard)', async () => {
        const selectWithoutOptions = {
          ...mockSecretType,
          fields: [
            {
              name: 'card_network',
              label: 'Card Network',
              type: 'select',
              required: false,
              sensitive: false,
              // options intentionally omitted — simulates a row written by
              // an older API version or direct DB write.
            },
          ],
        };
        mockPrisma.secretType.findUnique.mockResolvedValue(selectWithoutOptions as any);
        const dto: CreateSecretDto = {
          name: 'Legacy Card',
          typeId,
          data: { card_network: 'anything-goes' },
        } as CreateSecretDto;

        await expect(service.create(dto, userId, ownerPerms)).resolves.toBeDefined();
      });
    });

    it('should reject an unrecognised field type via the defensive else branch', async () => {
      const unknownTypeSecretType = {
        ...mockSecretType,
        fields: [
          {
            name: 'mystery',
            label: 'Mystery Field',
            type: 'boolean', // not a supported FieldDefinition type
            required: false,
            sensitive: false,
          },
        ],
      };
      mockPrisma.secretType.findUnique.mockResolvedValue(unknownTypeSecretType as any);
      const dto: CreateSecretDto = {
        name: 'Bad Type Secret',
        typeId,
        data: { mystery: 'value' },
      } as unknown as CreateSecretDto;

      let caught: BadRequestException | undefined;
      try {
        await service.create(dto, userId, ownerPerms);
      } catch (err) {
        caught = err as BadRequestException;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      const response = caught!.getResponse() as { details: { errors: string[] } };
      expect(response.details.errors.join(' ')).toContain('unsupported type');
    });

    it('regression: a Card-shaped payload omitting the new optional fields still validates', async () => {
      // Guarantees that pre-existing card secrets (created before
      // card_network/card_kind/security_code_2/issuing_bank existed) keep
      // working without being backfilled.
      const cardType = SYSTEM_SECRET_TYPES.find((t) => t.name === 'Card')!;
      mockPrisma.secretType.findUnique.mockResolvedValue({
        ...mockSecretType,
        name: 'Card',
        fields: cardType.fields,
        allowAttachments: cardType.allowAttachments,
      } as any);

      const dto: CreateSecretDto = {
        name: 'Old Card',
        typeId,
        data: {
          cardholder_name: 'Alice Example',
          number: '4111111111111111',
          exp_month: '01',
          exp_year: '2030',
          cvv: '123',
          // card_network, card_kind, security_code_2, issuing_bank omitted
        },
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

  // ============================================================================
  // Attachment carry-forward
  // ============================================================================

  describe('attachment carry-forward', () => {
    const newVersionId = 'version-new';
    const writePerms = [PERMISSIONS.SECRETS_WRITE];

    // A card image AND a role-less generic attachment. The generic one is the
    // regression guard: carrying only card roles strands a Document's files.
    const cardFront = {
      id: 'att-front',
      secretId,
      secretVersionId: versionId,
      storageObjectId: 'object-front',
      role: 'card_front',
      label: 'Front',
    };
    const genericDoc = {
      id: 'att-doc',
      secretId,
      secretVersionId: versionId,
      storageObjectId: 'object-doc',
      role: null,
      label: 'Scan.pdf',
    };

    describe('on update', () => {
      const updateDto: UpdateSecretDto = {
        data: { username: 'new_user', password: 'new_pass' },
      } as UpdateSecretDto;

      beforeEach(() => {
        mockPrisma.secret.findUnique.mockResolvedValue({
          ...mockSecret,
          versions: [mockVersion],
          attachments: [],
        } as any);
        mockPrisma.secret.update.mockResolvedValue(mockSecret as any);
        // 1st findFirst = max version lookup, 2nd = current-version lookup
        mockPrisma.secretVersion.findFirst
          .mockResolvedValueOnce({ version: 1 } as any)
          .mockResolvedValueOnce({ id: versionId } as any);
        mockPrisma.secretVersion.updateMany.mockResolvedValue({ count: 1 } as any);
        mockPrisma.secretVersion.create.mockResolvedValue({
          ...mockVersion,
          id: newVersionId,
          version: 2,
        } as any);
        mockPrisma.secretAttachment.findMany.mockResolvedValue([
          cardFront,
          genericDoc,
        ] as any);
        mockPrisma.secretAttachment.createMany.mockResolvedValue({ count: 2 } as any);
        mockPrisma.auditEvent.create.mockResolvedValue({} as any);
      });

      it('should copy EVERY attachment forward, including role-less ones', async () => {
        await service.update(secretId, updateDto, userId, writePerms);

        // The source query must select the whole version, unfiltered. Narrowing
        // it to card roles would orphan a Document's generic attachments.
        const sourceQuery = (mockPrisma.secretAttachment.findMany as jest.Mock).mock
          .calls[0][0];
        expect(sourceQuery.where).toEqual({ secretVersionId: versionId });

        expect(mockPrisma.secretAttachment.createMany).toHaveBeenCalledTimes(1);
        const rows = (mockPrisma.secretAttachment.createMany as jest.Mock).mock
          .calls[0][0].data;

        expect(rows).toHaveLength(2);
        expect(rows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ role: 'card_front', label: 'Front' }),
            // The generic attachment must survive the edit too.
            expect.objectContaining({ role: null, label: 'Scan.pdf' }),
          ]),
        );
      });

      it('should reuse the SAME storageObjectId (never duplicate the blob)', async () => {
        await service.update(secretId, updateDto, userId, writePerms);

        const rows = (mockPrisma.secretAttachment.createMany as jest.Mock).mock
          .calls[0][0].data;

        expect(rows.map((r: any) => r.storageObjectId).sort()).toEqual([
          'object-doc',
          'object-front',
        ]);
      });

      it('should stamp the copies onto the newly created version', async () => {
        await service.update(secretId, updateDto, userId, writePerms);

        expect(mockPrisma.secretAttachment.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { secretVersionId: versionId } }),
        );

        const rows = (mockPrisma.secretAttachment.createMany as jest.Mock).mock
          .calls[0][0].data;
        expect(rows.every((r: any) => r.secretVersionId === newVersionId)).toBe(true);
      });

      it('should resolve the source version before clearing isCurrent', async () => {
        await service.update(secretId, updateDto, userId, writePerms);

        // The current-version lookup is the 2nd findFirst; if updateMany ran
        // first it would find nothing and silently carry nothing forward.
        const lookupOrder = (mockPrisma.secretVersion.findFirst as jest.Mock).mock
          .invocationCallOrder[1];
        const updateManyOrder = (mockPrisma.secretVersion.updateMany as jest.Mock)
          .mock.invocationCallOrder[0];
        expect(lookupOrder).toBeLessThan(updateManyOrder);
      });

      it('should record the carried count on the audit event', async () => {
        await service.update(secretId, updateDto, userId, writePerms);

        expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            action: 'secret.update',
            meta: expect.objectContaining({ carriedAttachments: 2 }),
          }),
        });
      });

      it('should not carry anything forward when only metadata changes', async () => {
        await service.update(
          secretId,
          { name: 'Renamed Only' } as UpdateSecretDto,
          userId,
          writePerms,
        );

        expect(mockPrisma.secretAttachment.createMany).not.toHaveBeenCalled();
      });
    });

    describe('on rollback', () => {
      const targetVersionId = 'version-target';
      const targetVersion = {
        ...mockVersion,
        id: targetVersionId,
        version: 1,
        isCurrent: false,
      };

      // The TARGET version's files — deliberately different objects from the
      // current version's, so carrying the wrong set is visible.
      const targetAttachments = [
        {
          id: 'att-old-front',
          secretId,
          secretVersionId: targetVersionId,
          storageObjectId: 'object-old-front',
          role: 'card_front',
          label: null,
        },
      ];

      beforeEach(() => {
        mockPrisma.secret.findUnique.mockResolvedValue({
          ...mockSecret,
          versions: [mockVersion],
          attachments: [],
        } as any);
        mockPrisma.secretVersion.findUnique.mockResolvedValue(targetVersion as any);
        mockPrisma.secretVersion.findFirst.mockResolvedValue({ version: 3 } as any);
        mockPrisma.secretVersion.updateMany.mockResolvedValue({ count: 3 } as any);
        mockPrisma.secretVersion.create.mockResolvedValue({
          ...mockVersion,
          id: newVersionId,
          version: 4,
        } as any);
        mockPrisma.secretAttachment.findMany.mockResolvedValue(
          targetAttachments as any,
        );
        mockPrisma.secretAttachment.createMany.mockResolvedValue({ count: 1 } as any);
        mockPrisma.auditEvent.create.mockResolvedValue({} as any);
      });

      it("should carry the TARGET version's attachments, not the current one's", async () => {
        await service.rollback(secretId, targetVersionId, userId, writePerms);

        expect(mockPrisma.secretAttachment.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { secretVersionId: targetVersionId },
          }),
        );
        // Never the current version — that would restore old field values
        // alongside the new card's photos.
        expect(mockPrisma.secretAttachment.findMany).not.toHaveBeenCalledWith(
          expect.objectContaining({ where: { secretVersionId: versionId } }),
        );
      });

      it('should copy the target rows onto the new version with the same objects', async () => {
        await service.rollback(secretId, targetVersionId, userId, writePerms);

        const rows = (mockPrisma.secretAttachment.createMany as jest.Mock).mock
          .calls[0][0].data;

        expect(rows).toEqual([
          expect.objectContaining({
            secretId,
            secretVersionId: newVersionId,
            storageObjectId: 'object-old-front',
            role: 'card_front',
          }),
        ]);
      });

      it('should never look up the current version when a source is supplied', async () => {
        await service.rollback(secretId, targetVersionId, userId, writePerms);

        expect(mockPrisma.secretVersion.findFirst).not.toHaveBeenCalledWith(
          expect.objectContaining({
            where: { secretId, isCurrent: true },
          }),
        );
      });
    });
  });

  // ============================================================================
  // findOne — current-version scoping
  // ============================================================================

  describe('findOne attachment scoping', () => {
    it('should return only the current version attachments', async () => {
      const staleAttachment = {
        ...mockAttachment,
        id: 'att-stale',
        secretVersionId: 'version-old',
        role: 'card_back',
      };

      mockPrisma.secret.findUnique
        .mockResolvedValueOnce(mockSecret as any)
        .mockResolvedValueOnce({
          ...mockSecret,
          versions: [mockVersion],
          // Carry-forward means the same file exists on every version. Without
          // scoping, the list doubles on every edit.
          attachments: [mockAttachment, staleAttachment],
        } as any);

      const result = await service.findOne(secretId, userId, [
        PERMISSIONS.SECRETS_READ,
      ]);

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].id).toBe(attachmentId);
      expect(result.attachments[0].secretVersionId).toBe(result.currentVersionId);
    });

    it('should scope the attachment include to the current version at the DB', async () => {
      mockPrisma.secret.findUnique
        .mockResolvedValueOnce(mockSecret as any)
        .mockResolvedValueOnce({
          ...mockSecret,
          versions: [mockVersion],
          attachments: [],
        } as any);

      await service.findOne(secretId, userId, [PERMISSIONS.SECRETS_READ]);

      const detailCall = (mockPrisma.secret.findUnique as jest.Mock).mock.calls[1][0];
      expect(detailCall.include.attachments.where).toEqual({
        secretVersion: { isCurrent: true },
      });
    });

    it('should return no attachments when the secret has no current version', async () => {
      mockPrisma.secret.findUnique
        .mockResolvedValueOnce(mockSecret as any)
        .mockResolvedValueOnce({
          ...mockSecret,
          versions: [],
          attachments: [mockAttachment],
        } as any);

      const result = await service.findOne(secretId, userId, [
        PERMISSIONS.SECRETS_READ,
      ]);

      expect(result.attachments).toHaveLength(0);
    });
  });

  // ============================================================================
  // findAttachments — version/role filters
  // ============================================================================

  describe('findAttachments', () => {
    const readPerms = [PERMISSIONS.SECRETS_READ];

    beforeEach(() => {
      mockPrisma.secret.findUnique.mockResolvedValue(mockSecret as any);
      mockPrisma.secretAttachment.findMany.mockResolvedValue([
        mockAttachment,
      ] as any);
    });

    it('should default to the current version when no versionId is given', async () => {
      mockPrisma.secretVersion.findFirst.mockResolvedValue({ id: versionId } as any);

      await service.findAttachments(secretId, userId, readPerms);

      expect(mockPrisma.secretAttachment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ secretId, secretVersionId: versionId }),
        }),
      );
    });

    it('should filter by an explicit versionId', async () => {
      mockPrisma.secretVersion.findUnique.mockResolvedValue({ secretId } as any);

      await service.findAttachments(secretId, userId, readPerms, {
        versionId: 'version-old',
      });

      expect(mockPrisma.secretAttachment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ secretVersionId: 'version-old' }),
        }),
      );
    });

    it('should filter by role', async () => {
      mockPrisma.secretVersion.findFirst.mockResolvedValue({ id: versionId } as any);

      await service.findAttachments(secretId, userId, readPerms, {
        role: 'card_front',
      });

      expect(mockPrisma.secretAttachment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ role: 'card_front' }),
        }),
      );
    });

    it("should reject a versionId belonging to a different secret", async () => {
      mockPrisma.secretVersion.findUnique.mockResolvedValue({
        secretId: 'other-secret',
      } as any);

      await expect(
        service.findAttachments(secretId, userId, readPerms, {
          versionId: 'version-elsewhere',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return an empty list when the secret has no current version', async () => {
      mockPrisma.secretVersion.findFirst.mockResolvedValue(null);

      const result = await service.findAttachments(secretId, userId, readPerms);

      expect(result).toEqual([]);
      expect(mockPrisma.secretAttachment.findMany).not.toHaveBeenCalled();
    });

    it('should stringify the BigInt size on the returned attachments', async () => {
      mockPrisma.secretVersion.findFirst.mockResolvedValue({ id: versionId } as any);

      const result = await service.findAttachments(secretId, userId, readPerms);

      expect(result[0].storageObject!.size).toBe('2048');
      expect(() => JSON.stringify(result)).not.toThrow();
    });

    it('should throw ForbiddenException when a non-owner lacks read_any', async () => {
      await expect(
        service.findAttachments(secretId, otherUserId, []),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ============================================================================
  // unlinkAttachment — refcount-aware deletion
  // ============================================================================

  describe('unlinkAttachment', () => {
    const writePerms = [PERMISSIONS.SECRETS_WRITE];
    const storageKey = mockStorageObject.storageKey;

    beforeEach(() => {
      mockPrisma.secret.findUnique.mockResolvedValue(mockSecret as any);
      mockPrisma.secretAttachment.findUnique.mockResolvedValue({
        ...mockAttachment,
        storageObject: { id: storageObjectId, storageKey },
      } as any);
      mockPrisma.secretAttachment.delete.mockResolvedValue(mockAttachment as any);
      mockPrisma.storageObject.delete.mockResolvedValue(mockStorageObject as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);
    });

    describe('when other references remain', () => {
      beforeEach(() => {
        // Two secrets referenced this object; one row survives the delete.
        mockPrisma.secretAttachment.count.mockResolvedValue(1 as any);
      });

      it('should delete the attachment row', async () => {
        await service.unlinkAttachment(secretId, attachmentId, userId, writePerms);

        expect(mockPrisma.secretAttachment.delete).toHaveBeenCalledWith({
          where: { id: attachmentId },
        });
      });

      it('should NOT delete the storage object row', async () => {
        await service.unlinkAttachment(secretId, attachmentId, userId, writePerms);

        // Deleting it would cascade away the other holder's attachment row.
        expect(mockPrisma.storageObject.delete).not.toHaveBeenCalled();
      });

      it('should NOT delete the blob', async () => {
        await service.unlinkAttachment(secretId, attachmentId, userId, writePerms);

        expect(mockStorage.delete).not.toHaveBeenCalled();
      });

      it('should record storageObjectDeleted=false on the audit event', async () => {
        await service.unlinkAttachment(secretId, attachmentId, userId, writePerms);

        expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            action: 'secret.attachment.unlink',
            meta: expect.objectContaining({ storageObjectDeleted: false }),
          }),
        });
      });
    });

    describe('when it was the last reference', () => {
      beforeEach(() => {
        mockPrisma.secretAttachment.count.mockResolvedValue(0 as any);
      });

      it('should delete the storage object row', async () => {
        await service.unlinkAttachment(secretId, attachmentId, userId, writePerms);

        expect(mockPrisma.storageObject.delete).toHaveBeenCalledWith({
          where: { id: storageObjectId },
        });
      });

      it('should delete the blob from the storage provider', async () => {
        await service.unlinkAttachment(secretId, attachmentId, userId, writePerms);

        expect(mockStorage.delete).toHaveBeenCalledWith(storageKey);
      });

      it('should record storageObjectDeleted=true on the audit event', async () => {
        await service.unlinkAttachment(secretId, attachmentId, userId, writePerms);

        expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            meta: expect.objectContaining({ storageObjectDeleted: true }),
          }),
        });
      });

      it('should not fail the request when the blob delete throws', async () => {
        mockStorage.delete.mockRejectedValue(new Error('S3 unavailable'));

        await expect(
          service.unlinkAttachment(secretId, attachmentId, userId, writePerms),
        ).resolves.toBeUndefined();

        // The transaction already committed; the audit event still lands.
        expect(mockPrisma.auditEvent.create).toHaveBeenCalled();
      });
    });

    describe('ordering', () => {
      beforeEach(() => {
        mockPrisma.secretAttachment.count.mockResolvedValue(0 as any);
      });

      it('should take a FOR UPDATE row lock before counting references', async () => {
        await service.unlinkAttachment(secretId, attachmentId, userId, writePerms);

        expect(mockPrisma.$queryRaw).toHaveBeenCalled();
        const sql = (mockPrisma.$queryRaw as jest.Mock).mock.calls[0][0].join('?');
        expect(sql).toContain('FOR UPDATE');
        expect(sql).toContain('storage_objects');

        // Without the lock held first, two concurrent unlinks of the last two
        // refs each observe a stale count and neither deletes.
        const lockOrder = (mockPrisma.$queryRaw as jest.Mock).mock
          .invocationCallOrder[0];
        const deleteOrder = (mockPrisma.secretAttachment.delete as jest.Mock).mock
          .invocationCallOrder[0];
        const countOrder = (mockPrisma.secretAttachment.count as jest.Mock).mock
          .invocationCallOrder[0];

        expect(lockOrder).toBeLessThan(deleteOrder);
        expect(deleteOrder).toBeLessThan(countOrder);
      });

      it('should delete the blob only AFTER the transaction resolves', async () => {
        const committed = jest.fn();

        // Re-wrap $transaction so "commit" is an observable event we can order
        // against, and resolve it a macrotask later — an S3 call issued inside
        // the transaction would land before the marker and fail this test.
        (mockPrisma.$transaction as jest.Mock).mockImplementation(
          async (arg: unknown) => {
            const result =
              typeof arg === 'function'
                ? await (arg as (tx: unknown) => Promise<unknown>)(mockPrisma)
                : arg;
            await new Promise((resolve) => setTimeout(resolve, 0));
            committed();
            return result;
          },
        );

        await service.unlinkAttachment(secretId, attachmentId, userId, writePerms);

        expect(committed).toHaveBeenCalled();
        expect(mockStorage.delete).toHaveBeenCalled();

        const commitOrder = committed.mock.invocationCallOrder[0];
        const blobDeleteOrder = (mockStorage.delete as jest.Mock).mock
          .invocationCallOrder[0];

        // Deleting the blob before commit would leave a live DB row pointing at
        // a vanished object if the transaction later rolled back.
        expect(commitOrder).toBeLessThan(blobDeleteOrder);

        const objectRowDeleteOrder = (mockPrisma.storageObject.delete as jest.Mock)
          .mock.invocationCallOrder[0];
        expect(objectRowDeleteOrder).toBeLessThan(commitOrder);
      });
    });

    describe('authorization and lookup', () => {
      beforeEach(() => {
        mockPrisma.secretAttachment.count.mockResolvedValue(0 as any);
      });

      it('should throw NotFoundException when the attachment does not exist', async () => {
        mockPrisma.secretAttachment.findUnique.mockResolvedValue(null);

        await expect(
          service.unlinkAttachment(secretId, 'missing', userId, writePerms),
        ).rejects.toThrow(NotFoundException);
      });

      it('should throw NotFoundException when the attachment belongs to another secret', async () => {
        mockPrisma.secretAttachment.findUnique.mockResolvedValue({
          ...mockAttachment,
          secretId: 'other-secret',
          storageObject: { id: storageObjectId, storageKey },
        } as any);

        await expect(
          service.unlinkAttachment(secretId, attachmentId, userId, writePerms),
        ).rejects.toThrow(NotFoundException);
      });

      it('should throw ForbiddenException when a non-owner lacks write_any', async () => {
        await expect(
          service.unlinkAttachment(secretId, attachmentId, otherUserId, []),
        ).rejects.toThrow(ForbiddenException);

        expect(mockPrisma.secretAttachment.delete).not.toHaveBeenCalled();
      });

      it('should allow a non-owner holding write_any to unlink', async () => {
        await expect(
          service.unlinkAttachment(secretId, attachmentId, otherUserId, [
            PERMISSIONS.SECRETS_WRITE_ANY,
          ]),
        ).resolves.toBeUndefined();
      });
    });
  });
});
