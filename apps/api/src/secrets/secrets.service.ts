import {
  Inject,
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
import { STORAGE_PROVIDER, StorageProvider } from '../storage/providers';
import { CreateSecretDto } from './dto/create-secret.dto';
import { UpdateSecretDto } from './dto/update-secret.dto';
import { SecretListQueryDto } from './dto/secret-list-query.dto';
import { LinkAttachmentDto } from './dto/link-attachment.dto';
import { AttachmentListQueryDto } from './dto/attachment-list-query.dto';
import {
  AttachmentResponseDto,
  AttachmentStorageObjectDto,
} from './dto/attachment-response.dto';

@Injectable()
export class SecretsService {
  private readonly logger = new Logger(SecretsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    // The raw provider, NOT ObjectsService: ObjectsService.delete() enforces its
    // own uploader-ownership check, which would reject an admin acting under
    // secrets:write_any on someone else's file. Ownership for this path is
    // already settled by getSecretWithAuthCheck().
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: StorageProvider,
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

      // Captured before narrowing so the defensive `else` can report it.
      const fieldType: string = field.type;

      if (field.type === 'string') {
        if (typeof value !== 'string') {
          errors.push(`Field "${key}" must be a string`);
        }
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
      } else if (field.type === 'select') {
        // A row can reach the DB with type 'select' and no options (direct DB
        // write, or an older API version). Skip the check rather than reject
        // every value and brick the type.
        const opts = field.options ?? [];
        if (opts.length > 0 && !opts.includes(String(value))) {
          errors.push(`Field "${key}" must be one of: ${opts.join(', ')}`);
        }
      } else {
        // Defensive: a future field type must never silently skip validation.
        errors.push(`Field "${key}" has an unsupported type "${fieldType}"`);
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
   * Map a StorageObject row to its attachment response shape.
   *
   * `size` is a BigInt column; it MUST be stringified here. Fastify's
   * serializer throws `TypeError: Do not know how to serialize a BigInt` on a
   * raw row, and this app intentionally does not install a global
   * `BigInt.prototype.toJSON` (that would change the existing storage
   * endpoints' output shape). Fields are listed explicitly so internal
   * columns (storageKey, s3UploadId, bucket) are not leaked.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapStorageObject(object: any): AttachmentStorageObjectDto | null {
    if (!object) {
      return null;
    }

    return {
      id: object.id,
      name: object.name,
      size: object.size?.toString() ?? '0',
      mimeType: object.mimeType,
      status: object.status,
      metadata: object.metadata ?? null,
      createdAt: object.createdAt,
      updatedAt: object.updatedAt,
    };
  }

  /**
   * Map a SecretAttachment row (with its included storageObject) to the
   * response shape used everywhere attachments leave this service.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapAttachment(attachment: any): AttachmentResponseDto {
    return {
      id: attachment.id,
      secretId: attachment.secretId,
      secretVersionId: attachment.secretVersionId,
      storageObjectId: attachment.storageObjectId,
      role: attachment.role ?? null,
      label: attachment.label ?? null,
      createdAt: attachment.createdAt,
      storageObject: this.mapStorageObject(attachment.storageObject),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapAttachments(attachments: any): AttachmentResponseDto[] {
    if (!Array.isArray(attachments)) {
      return [];
    }
    return attachments.map((a) => this.mapAttachment(a));
  }

  /**
   * Narrow an unknown error to a Prisma unique-constraint violation (P2002).
   * Duck-typed rather than `instanceof` so it also holds for errors surfaced
   * through mocks and transaction wrappers.
   */
  private isUniqueConstraintViolation(
    error: unknown,
  ): error is { code: string; meta?: { target?: unknown } } {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === 'P2002'
    );
  }

  /**
   * Create the next version of a secret inside an open transaction, carrying
   * that version's attachments forward.
   *
   * This is the ONE place a new SecretVersion is minted (update, rollback, and
   * — issue #30 — renew all route through here). Carry-forward MUST live here:
   * a caller that mints its own version silently orphans every attachment on
   * the previous one.
   *
   * `sourceVersionId` selects which version's attachments are copied:
   *   - omitted  -> the current version (update / renew semantics)
   *   - supplied -> that exact version (rollback restores the TARGET version's
   *                 files; carrying the current set instead would leave the old
   *                 card's numbers sitting next to the new card's photos)
   *
   * Rows are copied with the SAME storageObjectId — an attachment is a pointer,
   * so the blob is shared, never duplicated. `@@unique([secretVersionId, role])`
   * cannot fire here: every copy lands on a freshly created version id.
   */
  private async createNewVersion(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
    params: {
      secretId: string;
      encrypted: { ciphertext: string; iv: string; authTag: string };
      userId: string;
      sourceVersionId?: string;
    },
  ): Promise<{ id: string; version: number; carriedAttachments: number }> {
    const { secretId, encrypted, userId } = params;

    const maxVersionRecord = await tx.secretVersion.findFirst({
      where: { secretId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const nextVersion = (maxVersionRecord?.version ?? 0) + 1;

    // Resolve the carry-forward source BEFORE the updateMany below clears
    // isCurrent, otherwise the default lookup finds nothing.
    let sourceVersionId = params.sourceVersionId;
    if (!sourceVersionId) {
      const currentVersion = await tx.secretVersion.findFirst({
        where: { secretId, isCurrent: true },
        select: { id: true },
      });
      sourceVersionId = currentVersion?.id;
    }

    await tx.secretVersion.updateMany({
      where: { secretId },
      data: { isCurrent: false },
    });

    const created = await tx.secretVersion.create({
      data: {
        secretId,
        version: nextVersion,
        encryptedData: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        isCurrent: true,
        createdById: userId,
      },
    });

    const carriedAttachments = await this.carryForwardAttachments(
      tx,
      secretId,
      sourceVersionId,
      created.id,
    );

    return {
      id: created.id,
      version: nextVersion,
      carriedAttachments,
    };
  }

  /**
   * Copy EVERY attachment row from one version to another. "Every" is load
   * bearing: role-less attachments (a Document's supporting files) are just as
   * much part of the secret as a card's front/back images, and skipping them
   * strands them on the superseded version where nothing reads them.
   */
  private async carryForwardAttachments(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
    secretId: string,
    sourceVersionId: string | undefined,
    targetVersionId: string,
  ): Promise<number> {
    if (!sourceVersionId || sourceVersionId === targetVersionId) {
      return 0;
    }

    const source = await tx.secretAttachment.findMany({
      where: { secretVersionId: sourceVersionId },
      select: { storageObjectId: true, role: true, label: true },
    });

    if (!Array.isArray(source) || source.length === 0) {
      return 0;
    }

    await tx.secretAttachment.createMany({
      data: source.map(
        (a: { storageObjectId: string; role: string | null; label: string | null }) => ({
          secretId,
          secretVersionId: targetVersionId,
          // Same storage object: the blob is shared between versions, and the
          // refcount-aware unlink below is what keeps it alive.
          storageObjectId: a.storageObjectId,
          role: a.role,
          label: a.label,
        }),
      ),
    });

    return source.length;
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
          // Attachments are carried forward onto every new version, so the
          // unscoped set holds one copy per version — it would appear to double
          // on each edit. Narrow at the DB so the row count stays flat.
          where: { secretVersion: { isCurrent: true } },
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

    // Filter again against the version id we actually report as
    // `currentVersionId`. The DB filter above trusts the isCurrent flag; this
    // guarantees the caller never sees an attachment belonging to a version
    // other than the one in the same response.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentAttachments = (secret.attachments as any[]).filter(
      (a) => a.secretVersionId === currentVersion?.id,
    );

    return {
      ...secret,
      // BigInt `size` on the storage objects must be stringified before it
      // reaches the serializer — see mapStorageObject().
      attachments: this.mapAttachments(currentAttachments),
      values,
      currentVersion: currentVersion?.version ?? null,
      // The row id (not the version number) of the current version. Clients
      // need it to attach files to the version they just created.
      currentVersionId: currentVersion?.id ?? null,
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

    let carriedAttachments = 0;

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

      // If data changed, create a new version. The helper carries the current
      // version's attachments forward so an edit never strands the files.
      if (newEncrypted) {
        const newVersion = await this.createNewVersion(tx, {
          secretId: id,
          encrypted: newEncrypted,
          userId,
        });
        carriedAttachments = newVersion.carriedAttachments;
      }

      return updated;
    });

    await this.createAuditEvent(userId, 'secret.update', id, {
      name: secret.name,
      dataChanged: newEncrypted !== null,
      ...(newEncrypted ? { carriedAttachments } : {}),
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
        // A historical version owns its own attachment rows (carried forward at
        // the time it was minted). Without these the version detail view shows
        // the old field values next to no files at all.
        attachments: { include: { storageObject: true } },
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      attachments: this.mapAttachments((version as any).attachments),
    };
  }

  /**
   * List a secret's attachments, optionally scoped to a specific version and/or
   * role.
   *
   * With no `versionId` this scopes to the current version — the same set
   * `findOne` returns. Passing an explicit `versionId` is how a client reads a
   * historical version's files.
   */
  async findAttachments(
    secretId: string,
    userId: string,
    userPermissions: string[],
    query: AttachmentListQueryDto = {},
  ): Promise<AttachmentResponseDto[]> {
    await this.getSecretWithAuthCheck(
      secretId,
      userId,
      PERMISSIONS.SECRETS_READ,
      userPermissions,
    );

    let versionId = query.versionId;

    if (versionId) {
      // Never let a versionId from another secret leak that secret's files.
      const version = await this.prisma.secretVersion.findUnique({
        where: { id: versionId },
        select: { secretId: true },
      });

      if (!version || version.secretId !== secretId) {
        throw new NotFoundException('Version not found');
      }
    } else {
      const currentVersion = await this.prisma.secretVersion.findFirst({
        where: { secretId, isCurrent: true },
        select: { id: true },
      });

      if (!currentVersion) {
        return [];
      }

      versionId = currentVersion.id;
    }

    const attachments = await this.prisma.secretAttachment.findMany({
      where: {
        secretId,
        secretVersionId: versionId,
        ...(query.role ? { role: query.role } : {}),
      },
      include: { storageObject: true },
      orderBy: { createdAt: 'asc' },
    });

    return this.mapAttachments(attachments);
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
    const newVersion = await this.prisma.$transaction(async (tx: any) =>
      this.createNewVersion(tx, {
        secretId,
        encrypted: { ciphertext, iv, authTag },
        userId,
        // Restore the TARGET version's files, not the current one's. A rollback
        // that kept the current attachments would show the old card's numbers
        // beside the new card's photos.
        sourceVersionId: oldVersion.id,
      }),
    );

    await this.createAuditEvent(userId, 'secret.rollback', secretId, {
      fromVersion: oldVersion.version,
      carriedAttachments: newVersion.carriedAttachments,
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

    // Resolve the current version and insert in ONE transaction, re-reading
    // isCurrent inside it. Reading the version outside the transaction lets an
    // update() commit in between, which would stamp the attachment onto a
    // now-stale version — the file would be invisible in the UI.
    let attachment;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      attachment = await this.prisma.$transaction(async (tx: any) => {
        const currentVersion = await tx.secretVersion.findFirst({
          where: { secretId, isCurrent: true },
          select: { id: true },
        });

        if (!currentVersion) {
          throw new NotFoundException(
            'Secret has no current version to attach to',
          );
        }

        return tx.secretAttachment.create({
          data: {
            secretId,
            secretVersionId: currentVersion.id,
            storageObjectId: dto.storageObjectId,
            role: dto.role,
            label: dto.label,
          },
          include: { storageObject: true },
        });
      });
    } catch (error) {
      throw this.translateAttachmentConflict(error, dto);
    }

    return this.mapAttachment(attachment);
  }

  /**
   * Turn a unique-constraint violation from the attachment insert into a 409
   * with an actionable message instead of letting it surface as a raw 500.
   *
   * Two unique constraints can fire: [secretVersionId, role] (one image per
   * role per version) and [secretVersionId, storageObjectId] (same file linked
   * twice). Any other error is returned unchanged for the caller to rethrow.
   */
  private translateAttachmentConflict(
    error: unknown,
    dto: LinkAttachmentDto,
  ): unknown {
    if (!this.isUniqueConstraintViolation(error)) {
      return error;
    }

    const target = error.meta?.target;
    const targetText = Array.isArray(target)
      ? target.join(',')
      : String(target ?? '');

    // Postgres reports either the column list or the constraint name.
    const isRoleConflict = targetText.includes('role')
      ? true
      : targetText === '' && Boolean(dto.role);

    if (isRoleConflict && dto.role) {
      const side = dto.role === 'card_front' ? 'front' : 'back';
      return new ConflictException(
        `This card already has a ${side} image for the current version`,
      );
    }

    return new ConflictException(
      'This file is already attached to the current version of this secret',
    );
  }

  /**
   * Remove an attachment, deleting the underlying StorageObject and its blob
   * only once nothing else references them.
   *
   * A StorageObject is shared: carry-forward points every version's rows at the
   * same object, and two different secrets may link the same upload. The
   * previous implementation deleted the object row unconditionally, which
   * cascaded through `SecretAttachment.storageObject onDelete: Cascade` and
   * silently destroyed every OTHER holder's attachment row.
   *
   * Ordering is deliberate and must not be rearranged:
   *   1. lock the storage_objects row  ->  2. delete the attachment row  ->
   *   3. count remaining refs  ->  4. delete the object row iff count is 0  ->
   *   5. COMMIT  ->  6. best-effort blob delete.
   *
   * The `FOR UPDATE` lock is what makes step 3 trustworthy. Without it two
   * concurrent unlinks of the last two references interleave their counts,
   * each observes 1 remaining, and neither deletes — leaking the object row and
   * its blob forever.
   *
   * The blob delete lives after the commit because it is irreversible: run
   * inside the transaction, a later rollback would leave a live DB row pointing
   * at a vanished object. A failure there is logged, never thrown — the DB is
   * already consistent and the caller's unlink genuinely succeeded.
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
      include: {
        storageObject: { select: { id: true, storageKey: true } },
      },
    });

    if (!attachment || attachment.secretId !== secretId) {
      throw new NotFoundException('Attachment not found');
    }

    const { storageObjectId } = attachment;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storageKey: string | null =
      (attachment as any).storageObject?.storageKey ?? null;

    this.logger.log(
      `Unlinking attachment ${attachmentId} from secret ${secretId}`,
    );

    const objectDeleted: boolean = await this.prisma.$transaction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (tx: any) => {
        // Serializes concurrent unlinks of this same object; the count below is
        // only meaningful while this lock is held.
        await tx.$queryRaw`SELECT id FROM storage_objects WHERE id = ${storageObjectId}::uuid FOR UPDATE`;

        await tx.secretAttachment.delete({ where: { id: attachmentId } });

        const remainingRefs: number = await tx.secretAttachment.count({
          where: { storageObjectId },
        });

        if (remainingRefs > 0) {
          // Another version or another secret still points at this object.
          return false;
        }

        await tx.storageObject.delete({ where: { id: storageObjectId } });
        return true;
      },
    );

    if (objectDeleted && storageKey) {
      try {
        await this.storageProvider.delete(storageKey);
      } catch (error) {
        // The row is gone and the transaction has committed. Losing the blob
        // costs storage, not correctness, so this must not fail the request.
        this.logger.error(
          `Orphaned blob: failed to delete ${storageKey} for storage object ${storageObjectId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    await this.createAuditEvent(userId, 'secret.attachment.unlink', secretId, {
      attachmentId,
      storageObjectId,
      storageObjectDeleted: objectDeleted,
    });

    this.logger.log(
      `Attachment ${attachmentId} removed from secret ${secretId}` +
        (objectDeleted
          ? ` (storage object ${storageObjectId} had no remaining references and was deleted)`
          : ` (storage object ${storageObjectId} still referenced, kept)`),
    );
  }
}
