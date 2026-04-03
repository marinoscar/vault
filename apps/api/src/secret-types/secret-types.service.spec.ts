import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';

import { SecretTypesService } from './secret-types.service';
import { PrismaService } from '../prisma/prisma.service';
import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import { CreateSecretTypeDto } from './dto/create-secret-type.dto';
import { UpdateSecretTypeDto } from './dto/update-secret-type.dto';
import { SecretTypeQueryDto } from './dto/secret-type-query.dto';

describe('SecretTypesService', () => {
  let service: SecretTypesService;
  let mockPrisma: MockPrismaService;

  const userId = 'user-aaa';
  const otherUserId = 'user-bbb';
  const typeId = 'type-111';

  const baseSecretType = {
    id: typeId,
    name: 'Login',
    description: 'Username + password',
    icon: null,
    fields: [
      { name: 'username', type: 'string', required: true },
      { name: 'password', type: 'string', required: true },
    ],
    allowAttachments: false,
    isSystem: false,
    createdById: userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const systemType = {
    ...baseSecretType,
    id: 'type-sys',
    name: 'System Type',
    isSystem: true,
    createdById: null,
  };

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecretTypesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SecretTypesService>(SecretTypesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // create
  // ============================================================================

  describe('create', () => {
    const createDto: CreateSecretTypeDto = {
      name: 'Login',
      description: 'Stores credentials',
      fields: [
        { name: 'username', type: 'string', required: true },
        { name: 'password', type: 'string', required: true },
      ],
      allowAttachments: false,
    } as CreateSecretTypeDto;

    it('should create a secret type with isSystem set to false', async () => {
      mockPrisma.secretType.create.mockResolvedValue(baseSecretType as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      await service.create(createDto, userId);

      expect(mockPrisma.secretType.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          isSystem: false,
          createdById: userId,
        }),
      });
    });

    it('should persist the supplied name, description, and fields', async () => {
      mockPrisma.secretType.create.mockResolvedValue(baseSecretType as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      await service.create(createDto, userId);

      expect(mockPrisma.secretType.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Login',
          description: 'Stores credentials',
        }),
      });
    });

    it('should default allowAttachments to false when not supplied', async () => {
      const dto = { name: 'No Attach', fields: [] } as unknown as CreateSecretTypeDto;
      mockPrisma.secretType.create.mockResolvedValue({ ...baseSecretType, allowAttachments: false } as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      await service.create(dto, userId);

      expect(mockPrisma.secretType.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ allowAttachments: false }),
      });
    });

    it('should return the created record', async () => {
      mockPrisma.secretType.create.mockResolvedValue(baseSecretType as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      const result = await service.create(createDto, userId);

      expect(result).toEqual(baseSecretType);
    });

    it('should create an audit event after creation', async () => {
      mockPrisma.secretType.create.mockResolvedValue(baseSecretType as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      await service.create(createDto, userId);

      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: userId,
          action: 'secret_type.create',
          targetId: baseSecretType.id,
        }),
      });
    });
  });

  // ============================================================================
  // findAll
  // ============================================================================

  describe('findAll', () => {
    const query: SecretTypeQueryDto = {
      includeSystem: true,
    } as SecretTypeQueryDto;

    it('should return only system types and own types when hasReadAny is false', async () => {
      mockPrisma.secretType.findMany.mockResolvedValue([systemType, baseSecretType] as any);

      await service.findAll(query, userId, false);

      expect(mockPrisma.secretType.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ isSystem: true }, { createdById: userId }],
          }),
        }),
      );
    });

    it('should not scope by ownership when hasReadAny is true', async () => {
      mockPrisma.secretType.findMany.mockResolvedValue([systemType, baseSecretType] as any);

      await service.findAll(query, userId, true);

      const callArg = (mockPrisma.secretType.findMany as jest.Mock).mock.calls[0][0];
      expect(callArg.where).not.toHaveProperty('OR');
    });

    it('should exclude system types when includeSystem is false', async () => {
      const noSystemQuery: SecretTypeQueryDto = { includeSystem: false } as SecretTypeQueryDto;
      mockPrisma.secretType.findMany.mockResolvedValue([baseSecretType] as any);

      await service.findAll(noSystemQuery, userId, false);

      expect(mockPrisma.secretType.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isSystem: false }),
        }),
      );
    });

    it('should apply a case-insensitive name search when search is provided', async () => {
      const searchQuery: SecretTypeQueryDto = { includeSystem: true, search: 'login' } as SecretTypeQueryDto;
      mockPrisma.secretType.findMany.mockResolvedValue([baseSecretType] as any);

      await service.findAll(searchQuery, userId, false);

      expect(mockPrisma.secretType.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            name: { contains: 'login', mode: 'insensitive' },
          }),
        }),
      );
    });

    it('should return all results from findMany', async () => {
      mockPrisma.secretType.findMany.mockResolvedValue([systemType, baseSecretType] as any);

      const result = await service.findAll(query, userId, true);

      expect(result).toHaveLength(2);
    });
  });

  // ============================================================================
  // findOne
  // ============================================================================

  describe('findOne', () => {
    it('should return the secret type when found', async () => {
      mockPrisma.secretType.findUnique.mockResolvedValue(baseSecretType as any);

      const result = await service.findOne(typeId);

      expect(result).toEqual(baseSecretType);
      expect(mockPrisma.secretType.findUnique).toHaveBeenCalledWith({
        where: { id: typeId },
      });
    });

    it('should throw NotFoundException when the ID does not exist', async () => {
      mockPrisma.secretType.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent-id')).rejects.toThrow(NotFoundException);
      await expect(service.findOne('nonexistent-id')).rejects.toThrow('Secret type not found');
    });
  });

  // ============================================================================
  // update
  // ============================================================================

  describe('update', () => {
    const updateDto: UpdateSecretTypeDto = { name: 'Updated Name' } as UpdateSecretTypeDto;

    it('should update and return the modified record', async () => {
      const updated = { ...baseSecretType, name: 'Updated Name' };
      mockPrisma.secretType.findUnique.mockResolvedValue(baseSecretType as any);
      mockPrisma.secretType.update.mockResolvedValue(updated as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      const result = await service.update(typeId, updateDto, userId);

      expect(result.name).toBe('Updated Name');
    });

    it('should throw BadRequestException when attempting to modify a system type', async () => {
      mockPrisma.secretType.findUnique.mockResolvedValue(systemType as any);

      await expect(service.update(systemType.id, updateDto, userId)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.update(systemType.id, updateDto, userId)).rejects.toThrow(
        'System types cannot be modified',
      );
    });

    it('should throw ForbiddenException when the caller does not own the type', async () => {
      mockPrisma.secretType.findUnique.mockResolvedValue(baseSecretType as any);

      await expect(service.update(typeId, updateDto, otherUserId)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.update(typeId, updateDto, otherUserId)).rejects.toThrow(
        'You do not own this secret type',
      );
    });

    it('should not call prisma.secretType.update for a system type', async () => {
      mockPrisma.secretType.findUnique.mockResolvedValue(systemType as any);

      try {
        await service.update(systemType.id, updateDto, userId);
      } catch {
        // expected
      }

      expect(mockPrisma.secretType.update).not.toHaveBeenCalled();
    });

    it('should create an audit event on successful update', async () => {
      const updated = { ...baseSecretType, name: 'Updated Name' };
      mockPrisma.secretType.findUnique.mockResolvedValue(baseSecretType as any);
      mockPrisma.secretType.update.mockResolvedValue(updated as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      await service.update(typeId, updateDto, userId);

      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: userId,
          action: 'secret_type.update',
          targetId: typeId,
        }),
      });
    });
  });

  // ============================================================================
  // remove
  // ============================================================================

  describe('remove', () => {
    it('should delete the type and return it', async () => {
      mockPrisma.secretType.findUnique.mockResolvedValue(baseSecretType as any);
      mockPrisma.secret.count.mockResolvedValue(0 as any);
      mockPrisma.secretType.delete.mockResolvedValue(baseSecretType as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      const result = await service.remove(typeId, userId);

      expect(mockPrisma.secretType.delete).toHaveBeenCalledWith({ where: { id: typeId } });
      expect(result).toEqual(baseSecretType);
    });

    it('should throw BadRequestException when attempting to delete a system type', async () => {
      mockPrisma.secretType.findUnique.mockResolvedValue(systemType as any);

      await expect(service.remove(systemType.id, userId)).rejects.toThrow(BadRequestException);
      await expect(service.remove(systemType.id, userId)).rejects.toThrow(
        'System types cannot be deleted',
      );
    });

    it('should throw ForbiddenException when the caller does not own the type', async () => {
      mockPrisma.secretType.findUnique.mockResolvedValue(baseSecretType as any);

      await expect(service.remove(typeId, otherUserId)).rejects.toThrow(ForbiddenException);
      await expect(service.remove(typeId, otherUserId)).rejects.toThrow(
        'You do not own this secret type',
      );
    });

    it('should throw ConflictException when secrets reference this type', async () => {
      mockPrisma.secretType.findUnique.mockResolvedValue(baseSecretType as any);
      mockPrisma.secret.count.mockResolvedValue(3 as any);

      await expect(service.remove(typeId, userId)).rejects.toThrow(ConflictException);
      await expect(service.remove(typeId, userId)).rejects.toThrow(
        'Cannot delete type that has secrets',
      );
    });

    it('should not call delete when secrets reference the type', async () => {
      mockPrisma.secretType.findUnique.mockResolvedValue(baseSecretType as any);
      mockPrisma.secret.count.mockResolvedValue(1 as any);

      try {
        await service.remove(typeId, userId);
      } catch {
        // expected
      }

      expect(mockPrisma.secretType.delete).not.toHaveBeenCalled();
    });

    it('should create an audit event on successful deletion', async () => {
      mockPrisma.secretType.findUnique.mockResolvedValue(baseSecretType as any);
      mockPrisma.secret.count.mockResolvedValue(0 as any);
      mockPrisma.secretType.delete.mockResolvedValue(baseSecretType as any);
      mockPrisma.auditEvent.create.mockResolvedValue({} as any);

      await service.remove(typeId, userId);

      expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: userId,
          action: 'secret_type.delete',
          targetId: typeId,
        }),
      });
    });
  });
});
