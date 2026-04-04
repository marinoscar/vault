import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/services/crypto.service';
import { FieldDefinition } from '../secret-types/dto/create-secret-type.dto';
import { PERMISSIONS } from '../common/constants/roles.constants';
import { CreateSecretDto } from './dto/create-secret.dto';
import { UpdateSecretDto } from './dto/update-secret.dto';
import { SecretListQueryDto } from './dto/secret-list-query.dto';
import { LinkAttachmentDto } from './dto/link-attachment.dto';

@Injectable()
export class SecretsService {
  private readonly logger = new Logger(SecretsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Validate the data record against the field definitions from the secret type.
   * Throws BadRequestException if any validation errors are found.
   */
  private validateDataAgainstType(
    data: Record<string, unknown>,
    fields: FieldDefinition[],
  ): void {
    const errors: string[] = [];
    const fieldMap = new Map(fields.map((f) => [f.name, f]));

    // Check all required fields are present and non-empty
    for (const field of fields) {
      if (field.required) {
        const value = data[field.name];
        if (value === undefined || value === null || value === '') {
          errors.push(`Field "${field.name}" is required`);
        }
      }
    }

    // Check submitted field names are valid and types match
    for (const [key, value] of Object.entries(data)) {
      const field = fieldMap.get(key);
      if (!field) {
        errors.push(`Unknown field "${key}"`);
        continue;
      }

      if (value === null || value === undefined || value === '') {
        // Optional fields can be empty
        continue;
      }

      if (field.type === 'string' && typeof value !== 'string') {
        errors.push(`Field "${key}" must be a string`);
      } else if (field.type === 'number') {
        if (typeof value !== 'number' && (typeof value !== 'string' || isNaN(Number(value)))) {
          errors.push(`Field "${key}" must be a number`);
        }
      } else if (field.type === 'date') {
        const dateStr = String(value);
        const parsed = new Date(dateStr);
        if (isNaN(parsed.getTime())) {
          errors.push(`Field "${key}" must be a valid ISO date string`);
        }
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Secret data validation failed',
        details: { errors },
      });
    }
  }

  /**
   * Fetch a secret by ID and check the caller has access.
   *
   * If the caller owns the secret, access is always granted.
   * If not the owner, the caller must have the `_any` variant of the
   * required permission (e.g. secrets:read_any for secrets:read).
   */
  private async getSecretWithAuthCheck(
    id: string,
    userId: string,
    requiredPermission: string,
    userPermissions: string[],
  ) {
    const secret = await this.prisma.secret.findUnique({
      where: { id },
      include: { type: true },
    });

    if (!secret) {
      throw new NotFoundException('Secret not found');
    }

    if (secret.createdById !== userId) {
      const anyPermission = requiredPermission.replace(/:([^:]+)$/, ':$1_any');
      if (!userPermissions.includes(anyPermission)) {
        throw new ForbiddenException('You do not have access to this secret');
      }
    }

    return secret;
  }

  /**
   * Decrypt a SecretVersion's encrypted data back to a parsed object.
   */
  private decryptVersionData(version: {
    encryptedData: string;
    iv: string;
    authTag: string;
  }): Record<string, unknown> {
    const plaintext = this.crypto.decrypt(
      version.encryptedData,
      version.iv,
      version.authTag,
    );
    return JSON.parse(plaintext) as Record<string, unknown>;
  }

  /**
   * Create an audit event for secret operations.
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
        targetType: 'secret',
        targetId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        meta: (meta ?? undefined) as any,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Create a new secret with an initial version.
   */
  async create(
    dto: CreateSecretDto,
    userId: string,
    userPermissions: string[],
  ) {
    this.logger.log(`Creating secret "${dto.name}" for user ${userId}`);

    // Fetch and validate the secret type
    const secretType = await this.prisma.secretType.findUnique({
      where: { id: dto.typeId },
    });

    if (!secretType) {
      throw new NotFoundException('Secret type not found');
    }

    const fields = secretType.fields as unknown as FieldDefinition[];
    this.validateDataAgainstType(dto.data as Record<string, unknown>, fields);

    // Check name uniqueness per user
    const existing = await this.prisma.secret.findFirst({
      where: { name: dto.name, createdById: userId },
    });
    if (existing) {
      throw new ConflictException(`A secret named "${dto.name}" already exists`);
    }

    // Encrypt the data
    const plaintext = JSON.stringify(dto.data);
    const { ciphertext, iv, authTag } = this.crypto.encrypt(plaintext);

    // Create secret + first version in a transaction
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const secret = await this.prisma.$transaction(async (tx: any) => {
      const created = await tx.secret.create({
        data: {
          name: dto.name,
          description: dto.description,
          typeId: dto.typeId,
          createdById: userId,
        },
        include: { type: true },
      });

      await tx.secretVersion.create({
        data: {
          secretId: created.id,
          version: 1,
          encryptedData: ciphertext,
          iv,
          authTag,
          isCurrent: true,
          createdById: userId,
        },
      });

      return created;
    });

    await this.createAuditEvent(userId, 'secret.create', secret.id, {
      name: secret.name,
      typeId: secret.typeId,
    });

    this.logger.log(`Secret created: ${secret.id}`);

    // Return with decrypted values attached
    return {
      ...secret,
      values: dto.data,
    };
  }

  /**
   * List secrets with pagination, filtering, and sorting.
   * Non-admin users only see their own secrets unless they have secrets:read_any.
   * Data is NOT decrypted in list responses.
   */
  async findAll(
    query: SecretListQueryDto,
    userId: string,
    userPermissions: string[],
  ) {
    const { page, pageSize, typeId, search, sortBy, sortOrder } = query;

    const canReadAny = userPermissions.includes(PERMISSIONS.SECRETS_READ_ANY);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      ...(canReadAny ? {} : { createdById: userId }),
      ...(typeId ? { typeId } : {}),
      ...(search
        ? { name: { contains: search, mode: 'insensitive' as const } }
        : {}),
    };

    const skip = (page - 1) * pageSize;

    const [items, totalItems] = await Promise.all([
      this.prisma.secret.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: pageSize,
        include: {
          type: true,
          versions: {
            where: { isCurrent: true },
            select: { version: true },
          },
        },
      }),
      this.prisma.secret.count({ where }),
    ]);

    const totalPages = Math.ceil(totalItems / pageSize);

    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: items.map((item: any) => ({
        ...item,
        currentVersion: item.versions[0]?.version ?? null,
        versions: undefined,
      })),
      meta: {
        page,
        pageSize,
        totalItems,
        totalPages,
      },
    };
  }

  /**
   * Look up a secret by name for the calling user (or any user for admins with secrets:read_any).
   * Returns full detail with decrypted current version data.
   */
  async findByName(
    name: string,
    userId: string,
    userPermissions: string[],
  ) {
    const canReadAny = userPermissions.includes(PERMISSIONS.SECRETS_READ_ANY);

    const secret = await this.prisma.secret.findFirst({
      where: {
        name,
        ...(canReadAny ? {} : { createdById: userId }),
      },
    });

    if (!secret) {
      throw new NotFoundException(`Secret "${name}" not found`);
    }

    // Reuse findOne for full detail with decryption
    return this.findOne(secret.id, userId, userPermissions);
  }

  /**
   * Get full secret detail including decrypted current version data.
   */
  async findOne(
    id: string,
    userId: string,
    userPermissions: string[],
  ) {
    await this.getSecretWithAuthCheck(
      id,
      userId,
      PERMISSIONS.SECRETS_READ,
      userPermissions,
    );

    const secret = await this.prisma.secret.findUnique({
      where: { id },
      include: {
        type: true,
        versions: {
          where: { isCurrent: true },
          include: { createdBy: { select: { id: true, email: true, displayName: true } } },
        },
        attachments: {
          include: {
            storageObject: true,
          },
        },
      },
    });

    if (!secret) {
      throw new NotFoundException('Secret not found');
    }

    const currentVersion = secret.versions[0];
    const values = currentVersion ? this.decryptVersionData(currentVersion) : null;

    return {
      ...secret,
      values,
      currentVersion: currentVersion?.version ?? null,
    };
  }

  /**
   * Update secret metadata and/or data (data change creates a new version).
   */
  async update(
    id: string,
    dto: UpdateSecretDto,
    userId: string,
    userPermissions: string[],
  ) {
    await this.getSecretWithAuthCheck(
      id,
      userId,
      PERMISSIONS.SECRETS_WRITE,
      userPermissions,
    );

    this.logger.log(`Updating secret ${id}`);

    // Fetch current type for validation if data is changing
    const existingSecret = await this.prisma.secret.findUnique({
      where: { id },
      include: { type: true },
    });

    if (!existingSecret) {
      throw new NotFoundException('Secret not found');
    }

    if (dto.name !== undefined && dto.name !== existingSecret.name) {
      const conflict = await this.prisma.secret.findFirst({
        where: { name: dto.name, createdById: existingSecret.createdById! },
      });
      if (conflict) {
        throw new ConflictException(`A secret named "${dto.name}" already exists`);
      }
    }

    let newEncrypted: { ciphertext: string; iv: string; authTag: string } | null = null;

    if (dto.data !== undefined) {
      const fields = existingSecret.type.fields as unknown as FieldDefinition[];
      this.validateDataAgainstType(dto.data as Record<string, unknown>, fields);

      const plaintext = JSON.stringify(dto.data);
      newEncrypted = this.crypto.encrypt(plaintext);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const secret = await this.prisma.$transaction(async (tx: any) => {
      // Update metadata
      const updated = await tx.secret.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.description !== undefined && { description: dto.description }),
        },
        include: { type: true },
      });

      // If data changed, create a new version
      if (newEncrypted) {
        // Find max current version number
        const maxVersionRecord = await tx.secretVersion.findFirst({
          where: { secretId: id },
          orderBy: { version: 'desc' },
          select: { version: true },
        });

        const nextVersion = (maxVersionRecord?.version ?? 0) + 1;

        // Mark all existing versions as not current
        await tx.secretVersion.updateMany({
          where: { secretId: id },
          data: { isCurrent: false },
        });

        // Create new current version
        await tx.secretVersion.create({
          data: {
            secretId: id,
            version: nextVersion,
            encryptedData: newEncrypted.ciphertext,
            iv: newEncrypted.iv,
            authTag: newEncrypted.authTag,
            isCurrent: true,
            createdById: userId,
          },
        });
      }

      return updated;
    });

    await this.createAuditEvent(userId, 'secret.update', id, {
      name: secret.name,
      dataChanged: newEncrypted !== null,
    });

    this.logger.log(`Secret updated: ${id}`);

    // Return with decrypted current data
    return this.findOne(id, userId, userPermissions);
  }

  /**
   * Delete a secret and all its versions (cascade handles versions/attachments).
   */
  async remove(
    id: string,
    userId: string,
    userPermissions: string[],
  ) {
    const secret = await this.getSecretWithAuthCheck(
      id,
      userId,
      PERMISSIONS.SECRETS_DELETE,
      userPermissions,
    );

    this.logger.log(`Deleting secret ${id}`);

    await this.prisma.secret.delete({ where: { id } });

    await this.createAuditEvent(userId, 'secret.delete', id, {
      name: secret.name,
    });

    this.logger.log(`Secret deleted: ${id}`);
  }

  /**
   * List all versions for a secret (metadata only, no decryption).
   */
  async findVersions(
    secretId: string,
    userId: string,
    userPermissions: string[],
  ) {
    await this.getSecretWithAuthCheck(
      secretId,
      userId,
      PERMISSIONS.SECRETS_READ,
      userPermissions,
    );

    const versions = await this.prisma.secretVersion.findMany({
      where: { secretId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        isCurrent: true,
        createdAt: true,
        createdBy: {
          select: { id: true, email: true, displayName: true },
        },
      },
    });

    return versions;
  }

  /**
   * Get a specific version with decrypted data.
   */
  async findVersion(
    secretId: string,
    versionId: string,
    userId: string,
    userPermissions: string[],
  ) {
    await this.getSecretWithAuthCheck(
      secretId,
      userId,
      PERMISSIONS.SECRETS_READ,
      userPermissions,
    );

    const version = await this.prisma.secretVersion.findUnique({
      where: { id: versionId },
      include: {
        createdBy: { select: { id: true, email: true, displayName: true } },
      },
    });

    if (!version || version.secretId !== secretId) {
      throw new NotFoundException('Version not found');
    }

    const data = this.decryptVersionData(version);

    return {
      id: version.id,
      version: version.version,
      isCurrent: version.isCurrent,
      createdAt: version.createdAt,
      createdBy: version.createdBy,
      values: data,
    };
  }

  /**
   * Rollback a secret to a previous version by creating a new version with the same data.
   */
  async rollback(
    secretId: string,
    versionId: string,
    userId: string,
    userPermissions: string[],
  ) {
    await this.getSecretWithAuthCheck(
      secretId,
      userId,
      PERMISSIONS.SECRETS_WRITE,
      userPermissions,
    );

    const oldVersion = await this.prisma.secretVersion.findUnique({
      where: { id: versionId },
    });

    if (!oldVersion || oldVersion.secretId !== secretId) {
      throw new NotFoundException('Version not found');
    }

    this.logger.log(`Rolling back secret ${secretId} to version ${oldVersion.version}`);

    // Decrypt the old data
    const plaintext = this.crypto.decrypt(
      oldVersion.encryptedData,
      oldVersion.iv,
      oldVersion.authTag,
    );

    // Re-encrypt with a fresh IV
    const { ciphertext, iv, authTag } = this.crypto.encrypt(plaintext);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.prisma.$transaction(async (tx: any) => {
      // Find max version number
      const maxVersionRecord = await tx.secretVersion.findFirst({
        where: { secretId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });

      const nextVersion = (maxVersionRecord?.version ?? 0) + 1;

      // Unmark current
      await tx.secretVersion.updateMany({
        where: { secretId },
        data: { isCurrent: false },
      });

      // Create new version
      await tx.secretVersion.create({
        data: {
          secretId,
          version: nextVersion,
          encryptedData: ciphertext,
          iv,
          authTag,
          isCurrent: true,
          createdById: userId,
        },
      });
    });

    await this.createAuditEvent(userId, 'secret.rollback', secretId, {
      fromVersion: oldVersion.version,
    });

    this.logger.log(`Secret ${secretId} rolled back, new version created`);

    return this.findOne(secretId, userId, userPermissions);
  }

  /**
   * Link an existing StorageObject as an attachment to a secret.
   */
  async linkAttachment(
    secretId: string,
    dto: LinkAttachmentDto,
    userId: string,
    userPermissions: string[],
  ) {
    const secret = await this.getSecretWithAuthCheck(
      secretId,
      userId,
      PERMISSIONS.SECRETS_WRITE,
      userPermissions,
    );

    if (!secret.type.allowAttachments) {
      throw new BadRequestException(
        'This secret type does not allow attachments',
      );
    }

    // Verify the storage object exists and the caller can use it
    const storageObject = await this.prisma.storageObject.findUnique({
      where: { id: dto.storageObjectId },
    });

    if (!storageObject) {
      throw new NotFoundException('Storage object not found');
    }

    const canWriteAny = userPermissions.includes(PERMISSIONS.SECRETS_WRITE_ANY);
    if (storageObject.uploadedById !== userId && !canWriteAny) {
      throw new ForbiddenException(
        'You do not have access to this storage object',
      );
    }

    this.logger.log(
      `Linking storage object ${dto.storageObjectId} to secret ${secretId}`,
    );

    const attachment = await this.prisma.secretAttachment.create({
      data: {
        secretId,
        storageObjectId: dto.storageObjectId,
        label: dto.label,
      },
      include: { storageObject: true },
    });

    return attachment;
  }

  /**
   * Remove an attachment from a secret and delete the underlying StorageObject.
   */
  async unlinkAttachment(
    secretId: string,
    attachmentId: string,
    userId: string,
    userPermissions: string[],
  ) {
    await this.getSecretWithAuthCheck(
      secretId,
      userId,
      PERMISSIONS.SECRETS_WRITE,
      userPermissions,
    );

    const attachment = await this.prisma.secretAttachment.findUnique({
      where: { id: attachmentId },
    });

    if (!attachment || attachment.secretId !== secretId) {
      throw new NotFoundException('Attachment not found');
    }

    this.logger.log(
      `Unlinking attachment ${attachmentId} from secret ${secretId}`,
    );

    // Delete the junction record (cascade from secret or explicit)
    await this.prisma.secretAttachment.delete({ where: { id: attachmentId } });

    // Delete the underlying storage object
    await this.prisma.storageObject.delete({
      where: { id: attachment.storageObjectId },
    });

    await this.createAuditEvent(userId, 'secret.attachment.unlink', secretId, {
      attachmentId,
      storageObjectId: attachment.storageObjectId,
    });

    this.logger.log(`Attachment ${attachmentId} removed from secret ${secretId}`);
  }
}
