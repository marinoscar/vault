import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { CreateSecretTypeDto } from './dto/create-secret-type.dto';
import { UpdateSecretTypeDto } from './dto/update-secret-type.dto';
import { SecretTypeQueryDto } from './dto/secret-type-query.dto';

@Injectable()
export class SecretTypesService {
  private readonly logger = new Logger(SecretTypesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new custom secret type
   */
  async create(dto: CreateSecretTypeDto, userId: string) {
    this.logger.log(`Creating secret type "${dto.name}" for user ${userId}`);

    const secretType = await this.prisma.secretType.create({
      data: {
        name: dto.name,
        description: dto.description,
        icon: dto.icon,
        fields: dto.fields as unknown as Prisma.InputJsonValue,
        allowAttachments: dto.allowAttachments ?? false,
        isSystem: false,
        createdById: userId,
      },
    });

    await this.createAuditEvent(userId, 'secret_type.create', secretType.id, {
      name: secretType.name,
    });

    this.logger.log(`Secret type created: ${secretType.id}`);

    return secretType;
  }

  /**
   * List secret types.
   *
   * - If hasReadAny is true, returns all types (including other users' custom types).
   * - Otherwise, returns system types + the requesting user's own custom types.
   * - Optionally filters by search term (case-insensitive contains on name).
   * - Optionally excludes system types when includeSystem is false.
   * - Ordered by isSystem desc, name asc.
   */
  async findAll(
    query: SecretTypeQueryDto,
    userId: string,
    hasReadAny: boolean,
  ) {
    const { search, includeSystem } = query;

    const where: Prisma.SecretTypeWhereInput = {};

    // Scope by ownership unless the caller can read all
    if (!hasReadAny) {
      where.OR = [
        { isSystem: true },
        { createdById: userId },
      ];
    }

    // Exclude system types when requested
    if (!includeSystem) {
      where.isSystem = false;
    }

    // Case-insensitive search on name
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const secretTypes = await this.prisma.secretType.findMany({
      where,
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });

    return secretTypes;
  }

  /**
   * Get a single secret type by ID or throw NotFoundException
   */
  async findOne(id: string) {
    const secretType = await this.prisma.secretType.findUnique({
      where: { id },
    });

    if (!secretType) {
      throw new NotFoundException('Secret type not found');
    }

    return secretType;
  }

  /**
   * Update a custom secret type.
   * Only the owner may update; system types cannot be modified.
   */
  async update(id: string, dto: UpdateSecretTypeDto, userId: string) {
    const secretType = await this.findOne(id);

    if (secretType.isSystem) {
      throw new BadRequestException('System types cannot be modified');
    }

    if (secretType.createdById !== userId) {
      throw new ForbiddenException('You do not own this secret type');
    }

    this.logger.log(`Updating secret type ${id}`);

    const updated = await this.prisma.secretType.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.icon !== undefined && { icon: dto.icon }),
        ...(dto.fields !== undefined && {
          fields: dto.fields as unknown as Prisma.InputJsonValue,
        }),
        ...(dto.allowAttachments !== undefined && {
          allowAttachments: dto.allowAttachments,
        }),
      },
    });

    await this.createAuditEvent(userId, 'secret_type.update', id, {
      name: updated.name,
    });

    this.logger.log(`Secret type updated: ${id}`);

    return updated;
  }

  /**
   * Delete a custom secret type.
   * Only the owner may delete; system types cannot be deleted.
   * Fails if any secrets reference this type.
   */
  async remove(id: string, userId: string) {
    const secretType = await this.findOne(id);

    if (secretType.isSystem) {
      throw new BadRequestException('System types cannot be deleted');
    }

    if (secretType.createdById !== userId) {
      throw new ForbiddenException('You do not own this secret type');
    }

    // Prevent deletion when secrets reference this type
    const secretCount = await this.prisma.secret.count({
      where: { typeId: id },
    });

    if (secretCount > 0) {
      throw new ConflictException('Cannot delete type that has secrets');
    }

    this.logger.log(`Deleting secret type ${id}`);

    await this.prisma.secretType.delete({ where: { id } });

    await this.createAuditEvent(userId, 'secret_type.delete', id, {
      name: secretType.name,
    });

    this.logger.log(`Secret type deleted: ${id}`);

    return secretType;
  }

  /**
   * Create an audit event for secret type operations
   */
  private async createAuditEvent(
    userId: string,
    action: string,
    targetId: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: userId,
        action,
        targetType: 'secret_type',
        targetId,
        meta: (meta ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
