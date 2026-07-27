import { Readable } from 'stream';

import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/services/crypto.service';
import { FieldDefinition } from '../secret-types/dto/create-secret-type.dto';
import { PERMISSIONS } from '../common/constants/roles.constants';
import { STORAGE_PROVIDER, StorageProvider } from '../storage/providers';
import { CreateSecretDto } from './dto/create-secret.dto';
import { UpdateSecretDto } from './dto/update-secret.dto';
import {
  RenewAttachmentInput,
  RenewSecretDto,
} from './dto/renew-secret.dto';
import { SecretListQueryDto } from './dto/secret-list-query.dto';
import { AttachmentRole, LinkAttachmentDto } from './dto/link-attachment.dto';
import { AttachmentListQueryDto } from './dto/attachment-list-query.dto';
import {
  AttachmentResponseDto,
  AttachmentStorageObjectDto,
} from './dto/attachment-response.dto';

/**
 * Mime types accepted for a card face image (`card_front` / `card_back`).
 *
 * Deliberately a code constant and NOT operator-configurable: widening it is a
 * decision about what the card UI can actually render, and an env var that can
 * be set to `image/*` would silently turn the allowlist off. The size cap below
 * IS configurable, because that is a deployment tuning knob rather than a
 * change in what the feature accepts.
 *
 * heic/heif are included because iOS cameras produce them by default; a user
 * photographing a card from an iPhone would otherwise be rejected.
 */
const CARD_IMAGE_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

/**
 * Default cap for a card face image: 5 MB.
 *
 * A card is a credit-card-sized rectangle photographed head-on. A 12 MP phone
 * photo of one lands around 2-4 MB of JPEG, so 5 MB clears every realistic
 * capture with headroom while still rejecting the multi-hundred-MB files the
 * global 10 GB `MAX_FILE_SIZE` would otherwise let through onto a card record.
 */
const DEFAULT_CARD_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Env var that overrides {@link DEFAULT_CARD_IMAGE_MAX_BYTES}.
 *
 * Read through ConfigService by raw env name rather than as a nested key like
 * `storage.cardImage.maxBytes`, because adding the key to
 * `src/config/configuration.ts` is outside the scope of this change. ConfigService
 * falls back to `process.env`, so this stays operator-tunable and moves to a
 * typed config key later without touching call sites here.
 */
const CARD_IMAGE_MAX_BYTES_ENV = 'CARD_IMAGE_MAX_BYTES';

/**
 * Attachment rows a version bump must NOT copy forward.
 *
 * Only renewal passes this. `roles` holds the card faces the caller is
 * replacing; `storageObjectIds` holds every incoming object, because the same
 * blob arriving under a different role than it previously held would otherwise
 * be inserted twice against the new version and trip
 * `@@unique([secretVersionId, storageObjectId])`.
 */
interface CarryForwardExclusions {
  roles: ReadonlySet<string>;
  storageObjectIds: ReadonlySet<string>;
}

@Injectable()
export class SecretsService {
  private readonly logger = new Logger(SecretsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
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
   * True for the roles that render as a card face image in the UI. Generic
   * attachments (role omitted) are untouched by the image constraints.
   */
  private isCardImageRole(role?: AttachmentRole): boolean {
    return role === 'card_front' || role === 'card_back';
  }

  /**
   * Resolve the card image size cap, in bytes.
   *
   * A non-numeric or non-positive override is ignored rather than obeyed: a
   * typo'd `CARD_IMAGE_MAX_BYTES=5MB` must not parse to NaN and disable the
   * check (every comparison against NaN is false, so nothing would ever be
   * rejected).
   */
  private getCardImageMaxBytes(): number {
    const raw = this.config.get<string | number>(CARD_IMAGE_MAX_BYTES_ENV);

    if (raw === undefined || raw === null || raw === '') {
      return DEFAULT_CARD_IMAGE_MAX_BYTES;
    }

    const parsed = typeof raw === 'number' ? raw : parseInt(raw, 10);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      this.logger.warn(
        `Ignoring invalid ${CARD_IMAGE_MAX_BYTES_ENV}="${String(raw)}"; ` +
          `falling back to ${DEFAULT_CARD_IMAGE_MAX_BYTES} bytes`,
      );
      return DEFAULT_CARD_IMAGE_MAX_BYTES;
    }

    return parsed;
  }

  /**
   * Measure what a stored object ACTUALLY weighs, by reading it back from the
   * storage provider and counting bytes.
   *
   * Why this exists: `ObjectsService.simpleUpload` — the endpoint the card UI
   * uploads through — writes `size: BigInt(0)` with a comment saying
   * post-processing will fill it in, and no processor ever does. So for every
   * real card image the recorded size is 0, and a plain `size > max` check
   * would pass 100% of uploads while reading like a working limit.
   *
   * Reading stops one byte past the limit: we only need to know whether the
   * object is over, not how far over. Worst case transfer is therefore
   * `limitBytes + 1`, not the whole object.
   */
  private async measureStoredObjectSize(
    storageKey: string,
    limitBytes: number,
  ): Promise<number> {
    let stream: Readable;

    try {
      stream = await this.storageProvider.download(storageKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Cannot read storage object ${storageKey} to verify its size: ${message}`,
      );
      // Fail closed. An object we cannot read is not one we should be stamping
      // onto a card: the attachment would render as a broken image anyway, so
      // rejecting here is the correct outcome and not merely the safe one.
      throw new BadRequestException(
        'This file could not be read from storage, so it cannot be attached',
      );
    }

    let total = 0;

    try {
      for await (const chunk of stream) {
        total += Buffer.isBuffer(chunk)
          ? chunk.length
          : Buffer.byteLength(String(chunk));

        if (total > limitBytes) {
          break;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed while measuring storage object ${storageKey}: ${message}`,
      );
      throw new BadRequestException(
        'This file could not be read from storage, so it cannot be attached',
      );
    } finally {
      stream.destroy();
    }

    return total;
  }

  /**
   * Enforce the card-face image constraints on a StorageObject before it is
   * linked: an image mime type from a fixed allowlist, and a size cap.
   */
  private async enforceCardImageConstraints(
    storageObject: { mimeType: string; size: bigint | number; storageKey: string },
    secretId: string,
    role: AttachmentRole,
  ): Promise<void> {
    // Normalize `image/jpeg; charset=binary` and casing before comparing.
    const mimeType = (storageObject.mimeType ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();

    if (!CARD_IMAGE_MIME_TYPES.includes(mimeType)) {
      this.logger.warn(
        `Rejected ${role} attachment on secret ${secretId}: ` +
          `mime type "${storageObject.mimeType}" is not an accepted card image type`,
      );
      throw new BadRequestException(
        `Card images must be one of ${CARD_IMAGE_MIME_TYPES.join(', ')}; ` +
          `received "${storageObject.mimeType}"`,
      );
    }

    const maxBytes = this.getCardImageMaxBytes();
    const recordedSize = Number(storageObject.size ?? 0);

    // A recorded size of 0 means "unknown", not "empty" — see
    // measureStoredObjectSize for why. Trust the recorded value when the upload
    // path supplied one (the resumable /upload/init path does), and pay for a
    // bounded read-back only when it did not.
    const actualSize =
      recordedSize > 0
        ? recordedSize
        : await this.measureStoredObjectSize(storageObject.storageKey, maxBytes);

    if (actualSize > maxBytes) {
      this.logger.warn(
        `Rejected ${role} attachment on secret ${secretId}: ` +
          `${actualSize} bytes exceeds the ${maxBytes} byte card image limit`,
      );
      throw new BadRequestException(
        `Card images must be ${maxBytes} bytes or smaller`,
      );
    }
  }

  /**
   * Load a StorageObject and confirm the caller may attach it.
   *
   * Extracted so `linkAttachment` and `renew` cannot drift: a renewal that
   * skipped the uploader check would be a way to staple another user's file onto
   * your own secret without ever calling the link endpoint.
   *
   * `secrets:write_any` is what lets an admin attach an object they did not
   * upload — the same escalation `getSecretWithAuthCheck` honours for the secret
   * itself.
   */
  private async resolveUsableStorageObject(
    storageObjectId: string,
    userId: string,
    userPermissions: string[],
  ) {
    const storageObject = await this.prisma.storageObject.findUnique({
      where: { id: storageObjectId },
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

    return storageObject;
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
   *
   * `excludeFromCarryForward` holds back the rows a renewal is about to replace,
   * so the replacements can be inserted against the new version in the same
   * transaction without colliding with a copy of the outgoing card's file.
   */
  private async createNewVersion(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
    params: {
      secretId: string;
      encrypted: { ciphertext: string; iv: string; authTag: string };
      userId: string;
      sourceVersionId?: string;
      excludeFromCarryForward?: CarryForwardExclusions;
    },
  ): Promise<{
    id: string;
    version: number;
    carriedAttachments: number;
    sourceVersionId?: string;
  }> {
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
      params.excludeFromCarryForward,
    );

    return {
      id: created.id,
      version: nextVersion,
      carriedAttachments,
      sourceVersionId,
    };
  }

  /**
   * Copy EVERY attachment row from one version to another. "Every" is load
   * bearing: role-less attachments (a Document's supporting files) are just as
   * much part of the secret as a card's front/back images, and skipping them
   * strands them on the superseded version where nothing reads them.
   *
   * "Every" is qualified only by `exclude`, which a renewal uses to hold back
   * the rows it is about to supersede.
   */
  private async carryForwardAttachments(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
    secretId: string,
    sourceVersionId: string | undefined,
    targetVersionId: string,
    exclude?: CarryForwardExclusions,
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

    // The exclusion is applied HERE, in JS, and deliberately not pushed into the
    // `where` above. A Prisma `role: { notIn: [...] }` compiles to SQL
    // `role NOT IN (...)`, which evaluates to NULL — and therefore does not
    // match — for every role-less row. Filtering in the query would silently
    // drop a Document's generic attachments alongside the card face being
    // replaced. The set is a handful of rows per version, so this costs nothing.
    const rows: Array<{
      storageObjectId: string;
      role: string | null;
      label: string | null;
    }> = exclude
      ? source.filter(
          (a: { storageObjectId: string; role: string | null }) =>
            !this.isSupersededByReplacement(a, exclude),
        )
      : source;

    if (rows.length === 0) {
      return 0;
    }

    await tx.secretAttachment.createMany({
      data: rows.map(
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

    return rows.length;
  }

  /**
   * True when an existing attachment row must NOT be carried onto the new
   * version because the renewal supplies something that takes its place.
   *
   * Two independent reasons, matching the two unique constraints on
   * SecretAttachment:
   *   - its role is being re-supplied  -> [secretVersionId, role]
   *   - its object is being re-supplied under any role
   *                                    -> [secretVersionId, storageObjectId]
   *
   * A role-less row is never excluded by the first test: `role` is NULL, and the
   * caller cannot "replace the NULL role" — there may be many such rows.
   */
  private isSupersededByReplacement(
    attachment: { storageObjectId: string; role: string | null },
    exclude: CarryForwardExclusions,
  ): boolean {
    if (attachment.role != null && exclude.roles.has(attachment.role)) {
      return true;
    }

    return exclude.storageObjectIds.has(attachment.storageObjectId);
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
   * Renew a secret: mint the next version from a NEW set of field values while
   * swapping only the files the caller actually re-supplied.
   *
   * Why this is not `update()` plus `linkAttachment()`. `update()` mints v_n+1
   * and carries v_n's attachment rows forward wholesale, including the outgoing
   * card's `card_front`. Linking the new `card_front` afterwards hits
   * `@@unique([secretVersionId, role])` and dies with P2002; and even without
   * that constraint the two calls are separate transactions, so between them
   * v_n+1 holds the NEW card's number next to the OLD card's photograph. A user
   * reading the card in that window sees a record that never existed.
   *
   * So the version bump, the selective carry-forward and the replacement insert
   * are one transaction, in that order:
   *
   *   1. createNewVersion() -> mints v_n+1 and copies forward every row from
   *      v_n whose role is NOT in the payload (and whose object is not being
   *      re-supplied under another role).
   *   2. createMany() -> inserts the replacements against v_n+1's id.
   *
   * The excluded roles are never written to v_n+1, so step 2 cannot collide with
   * step 1's copies, and a failure in either rolls the whole thing back — v_n
   * stays current, and no half-renewed version is ever visible.
   *
   * v_n is untouched throughout. Its own attachment rows still point at the old
   * card's images, which is what makes the old number, name, expiry AND photos
   * readable from the version history after the card is replaced.
   */
  async renew(
    secretId: string,
    dto: RenewSecretDto,
    userId: string,
    userPermissions: string[],
  ) {
    const secret = await this.getSecretWithAuthCheck(
      secretId,
      userId,
      PERMISSIONS.SECRETS_WRITE,
      userPermissions,
    );

    const fields = secret.type.fields as unknown as FieldDefinition[];
    this.validateDataAgainstType(dto.data as Record<string, unknown>, fields);

    const replacements = dto.attachments ?? [];

    if (replacements.length > 0 && !secret.type.allowAttachments) {
      throw new BadRequestException(
        'This secret type does not allow attachments',
      );
    }

    this.assertReplacementsAreDistinct(replacements);

    // Validate EVERY replacement before opening the transaction. The card image
    // check may stream the object back from the storage provider to measure it,
    // and holding a write transaction open across a network read is how a lock
    // pile-up starts. Failing here also means a rejected image never reaches the
    // version bump at all.
    for (const replacement of replacements) {
      const storageObject = await this.resolveUsableStorageObject(
        replacement.storageObjectId,
        userId,
        userPermissions,
      );

      if (this.isCardImageRole(replacement.role)) {
        await this.enforceCardImageConstraints(
          storageObject,
          secretId,
          replacement.role as AttachmentRole,
        );
      }
    }

    const replacedRoles = new Set<string>(
      replacements
        .map((r) => r.role)
        .filter((role): role is AttachmentRole => Boolean(role)),
    );
    const replacedObjectIds = new Set<string>(
      replacements.map((r) => r.storageObjectId),
    );

    this.logger.log(
      `Renewing secret ${secretId} (${replacements.length} replacement file(s), ` +
        `roles: ${[...replacedRoles].join(', ') || 'none'})`,
    );

    const encrypted = this.crypto.encrypt(JSON.stringify(dto.data));

    let newVersion: {
      id: string;
      version: number;
      carriedAttachments: number;
      sourceVersionId?: string;
    };

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      newVersion = await this.prisma.$transaction(async (tx: any) => {
        const version = await this.createNewVersion(tx, {
          secretId,
          encrypted,
          userId,
          excludeFromCarryForward: {
            roles: replacedRoles,
            storageObjectIds: replacedObjectIds,
          },
        });

        if (replacements.length > 0) {
          await tx.secretAttachment.createMany({
            data: replacements.map((r) => ({
              secretId,
              secretVersionId: version.id,
              storageObjectId: r.storageObjectId,
              role: r.role ?? null,
              label: r.label ?? null,
            })),
          });
        }

        return version;
      });
    } catch (error) {
      // Same wording as the link endpoint. A P2002 here means two clients
      // renewed the same secret concurrently; the loser gets a 409, not a 500.
      throw this.translateAttachmentConflict(error, replacements[0] ?? {});
    }

    await this.createAuditEvent(userId, 'secret.renew', secretId, {
      fromVersionId: newVersion.sourceVersionId ?? null,
      version: newVersion.version,
      carriedAttachments: newVersion.carriedAttachments,
      replacedAttachments: replacements.length,
      replacedRoles: [...replacedRoles].sort(),
      // The ONLY thing recorded about the extraction. No field names, no field
      // values: the audit trail is queried by support staff who have no business
      // reading a card number, and an audit row is not encrypted the way a
      // SecretVersion is.
      extractionMethod: dto.aiAssisted ? 'ai_assisted' : 'manual',
    });

    this.logger.log(
      `Secret ${secretId} renewed as version ${newVersion.version} ` +
        `(${newVersion.carriedAttachments} carried, ${replacements.length} replaced)`,
    );

    return this.findOne(secretId, userId, userPermissions);
  }

  /**
   * Reject a renewal payload that would collide with itself.
   *
   * Both checks mirror a unique constraint on SecretAttachment. Without them the
   * insert fails inside the transaction with a P2002 that says nothing about
   * which entry was at fault; a 400 naming the duplicate is actionable, and it
   * costs nothing to check before any storage lookups are paid for.
   */
  private assertReplacementsAreDistinct(
    replacements: RenewAttachmentInput[],
  ): void {
    const errors: string[] = [];
    const seenRoles = new Set<string>();
    const seenObjectIds = new Set<string>();

    for (const replacement of replacements) {
      if (replacement.role) {
        if (seenRoles.has(replacement.role)) {
          errors.push(
            `Duplicate role "${replacement.role}" in attachments`,
          );
        }
        seenRoles.add(replacement.role);
      }

      if (seenObjectIds.has(replacement.storageObjectId)) {
        errors.push(
          `Storage object "${replacement.storageObjectId}" is listed more than once`,
        );
      }
      seenObjectIds.add(replacement.storageObjectId);
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Renewal attachments must be unique',
        details: { errors },
      });
    }
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
    const storageObject = await this.resolveUsableStorageObject(
      dto.storageObjectId,
      userId,
      userPermissions,
    );

    // Card faces are rendered as images in the UI and carried forward onto
    // every future version, so the type/size gate belongs here — before the
    // attachment row exists — rather than at render time.
    if (this.isCardImageRole(dto.role)) {
      await this.enforceCardImageConstraints(
        storageObject,
        secretId,
        dto.role as AttachmentRole,
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
   *
   * Takes only the role rather than a whole LinkAttachmentDto so renewal, whose
   * entries are the same shape minus the secret id, reuses the same wording
   * instead of inventing a second set of conflict messages.
   */
  private translateAttachmentConflict(
    error: unknown,
    dto: { role?: AttachmentRole },
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
