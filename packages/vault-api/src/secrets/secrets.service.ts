import { Readable } from 'stream';

import {
  Inject,
  Injectable,
  Optional,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';



import { isCountryCode } from '@marinoscar/vault-contract/common';
import { keyValueValueSchema } from '@marinoscar/vault-contract/secret-types';
import {
  originsFromCredential,
  matchOrigin,
  normalizeOrigin,
  normalizeTotpSecret,
  parseTotpSecret,
  registrableDomainOfOrigin,
  documentNoun,
  imageSlotFor,
  imageSlotsFor,
  isDocumentImageRole,
} from '@marinoscar/vault-contract/secrets';
import { generateTotp, TotpCode } from './totp';
import { defaultOrgClient, runInDefaultOrg } from '../core/default-org';


import { secretTypeKind } from '../core/metric-labels';
import { FieldDefinition } from '../secret-types/dto/create-secret-type.dto';
import { PERMISSIONS } from '../core/roles.constants';
import {
  detectImageType,
  isDeclaredTypeConsistent,
  IMAGE_SIGNATURE_HEADER_BYTES,
} from '../core/image-signature.util';

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
import {
  VAULT_AUDIT,
  VAULT_CRYPTO,
  VAULT_METRICS,
  VAULT_OBJECT_STORE,
  VAULT_PRISMA,
  VAULT_SETTINGS,
  type VaultAuditPort,
  type VaultCryptoPort,
  type VaultMetricsPort,
  type VaultObjectStorePort,
  type VaultPrismaClient,
  type VaultSettingsPort,
} from '../ports';

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
 *
 * The same list gates every document image role (card faces, passport pages,
 * ID document faces): they are all photographs rendered by the same UI.
 *
 * This list gates the DECLARED type. `enforceDocumentImageConstraints` separately
 * verifies the file's leading bytes against the same set, so a declaration on
 * this list has to be backed up by the contents.
 */
const CARD_IMAGE_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];


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

/**
 * `data` with every `format: 'country'` string value trimmed and upper-cased
 * (`usa` is stored as `USA`). Runs after validation; other values are untouched.
 */
function normalizeCountryFields(
  data: Record<string, unknown>,
  fields: FieldDefinition[],
): Record<string, unknown> {
  let out = data;
  for (const field of fields) {
    const value = data[field.name];
    if (field.type !== 'string' || field.format !== 'country' || typeof value !== 'string') continue;
    const code = value.trim().toUpperCase();
    if (code !== value) out = { ...out, [field.name]: code };
  }
  return out;
}

/** JSON with object keys sorted, so two equal values serialize the same whatever their key order. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** The shape `assertAgentAccessible` reads. */
export interface AgentAccessCandidate {
  agentAccess?: string | null;
  type?: { name?: string | null; isSystem?: boolean | null } | null;
}

/** Only the `Credential` system secret type may be opened to agents. */
export function isAgentAccessibleType(
  type: { name?: string | null; isSystem?: boolean | null } | null | undefined,
): boolean {
  return !!type && type.isSystem === true && type.name === 'Credential';
}

/** The system types an owner may open to agents (ADR-0002 logins, ADR-0003 cards and identity). */
export const AGENT_OPENABLE_TYPE_NAMES = ['Credential', 'Card', 'Identity'] as const;

/** @stability experimental */
export type AgentOpenableTypeName = (typeof AGENT_OPENABLE_TYPE_NAMES)[number];

/** Whether `type` is a system type an owner may open to agents: `Credential`, `Card` or `Identity`. */
export function isAgentOpenableType(
  type: { name?: string | null; isSystem?: boolean | null } | null | undefined,
): boolean {
  return !!type && type.isSystem === true && (AGENT_OPENABLE_TYPE_NAMES as readonly string[]).includes(type.name ?? '');
}

/** Whether `type` is the system type `name`. */
export function isSystemTypeNamed(
  type: { name?: string | null; isSystem?: boolean | null } | null | undefined,
  name: AgentOpenableTypeName,
): boolean {
  return !!type && type.isSystem === true && type.name === name;
}

/**
 * The origins to store for `data` of a secret of `type`: derived for a Credential (an empty array
 * clears them), `undefined` for every other type (the column stays `{}`).
 */
export function computeSecretOrigins(
  type: { name?: string | null; isSystem?: boolean | null } | null | undefined,
  data: Record<string, unknown> | null | undefined,
): string[] | undefined {
  if (!isAgentAccessibleType(type)) return undefined;
  return originsFromCredential((data ?? {}) as { url?: unknown; additional_urls?: unknown });
}

/** An agent-accessible Credential matched by origin. Non-sensitive metadata only. */
export interface CredentialOriginMatch {
  id: string;
  name: string;
  username: string | null;
  origins: string[];
  matchKind: 'exact' | 'site';
}

@Injectable()
export class SecretsService {
  private readonly logger = new Logger(SecretsService.name);

  /**
   * Vault's metrics (E9.2). Property-injected and optional so this constructor, which
   * the storage work rewrites, is untouched and a hand-built service runs with metrics off.
   * Labels are enums only; no secret id, name or user id is ever passed.
   */
  @Optional()
  @Inject(VAULT_METRICS)
  private readonly vaultMetrics?: VaultMetricsPort;

  constructor(
    @Inject(VAULT_PRISMA) private readonly prisma: VaultPrismaClient,
    @Inject(VAULT_CRYPTO) private readonly crypto: VaultCryptoPort,
    @Inject(VAULT_SETTINGS) private readonly systemSettings: VaultSettingsPort,
    // The raw provider, NOT ObjectsService: ObjectsService.delete() enforces its
    // own uploader-ownership check, which would reject an admin acting under
    // secrets:write_any on someone else's file. Ownership for this path is
    // already settled by getSecretWithAuthCheck().
    @Inject(VAULT_OBJECT_STORE)
    private readonly storageProvider: VaultObjectStorePort,
    @Inject(VAULT_AUDIT) private readonly auditLog: VaultAuditPort,
  ) {}

  /**
   * PLATFORM-ADOPTION-SHIM(multi-org): reads that join `storage_objects` (a row-level
   * security table) run in the default organization's scope, as do the
   * attachment transactions (`runInDefaultOrg`). The API is an ordinary role.
   */
  private get orgDb() {
    return defaultOrgClient(this.prisma);
  }

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

    // Check all required fields are present and non-empty. A required
    // `keyvalue` field needs at least one entry.
    for (const field of fields) {
      if (field.required) {
        const value = data[field.name];
        if (
          value === undefined ||
          value === null ||
          value === '' ||
          (field.type === 'keyvalue' && Array.isArray(value) && value.length === 0)
        ) {
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
        } else if (field.format === 'country' && value.trim() !== '' && !isCountryCode(value.trim().toUpperCase())) {
          // Never echo the value: name the field only.
          errors.push(`Field "${key}" must be an ISO 3166-1 alpha-3 country code`);
        }
        // `format: 'multiline'` and `mask` are display only.
      } else if (field.type === 'keyvalue') {
        // Stored as-is inside the encrypted JSON. Issue paths and messages name
        // the entry and the property, never a value.
        const parsed = keyValueValueSchema.safeParse(value);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          const where = issue && issue.path.length > 0 ? ` (at ${issue.path.join('.')})` : '';
          errors.push(
            Array.isArray(value)
              ? `Field "${key}" has an invalid entry${where}: ${issue?.message ?? 'invalid'}`
              : `Field "${key}" must be a list of key/value entries`,
          );
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
   * Validate `data` against the type's fields and return it with the Credential `totp` value
   * normalized to the canonical otpauth URI. An invalid `totp` is a 400 with a field error.
   * Other types (and a custom type that happens to have a `totp` field) are returned unchanged.
   */
  private prepareData(
    type: { name?: string | null; isSystem?: boolean | null; fields: unknown },
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    this.validateDataAgainstType(data, type.fields as FieldDefinition[]);
    data = normalizeCountryFields(data, type.fields as FieldDefinition[]);
    if (!isAgentAccessibleType(type)) return data;
    const raw = data.totp;
    if (typeof raw !== 'string' || raw.trim() === '') return data;
    const canonical = normalizeTotpSecret(raw);
    if (!canonical) {
      throw new BadRequestException({
        message: 'Secret data validation failed',
        details: {
          errors: [
            'Field "totp" must be an otpauth://totp URI or a base32 secret (SHA1, SHA256 or SHA512; 6 to 8 digits; 15 to 120 second period)',
          ],
        },
      });
    }
    return { ...data, totp: canonical };
  }

  /**
   * Whether `data` equals the data of `current` (the current version). A
   * missing version, or one that fails to decrypt, answers `false`, so the
   * update writes a version.
   */
  private isCurrentData(
    current: { encryptedData: string; iv: string; authTag: string } | undefined,
    data: Record<string, unknown>,
  ): boolean {
    if (!current?.encryptedData) return false;
    try {
      return stableJson(this.decryptVersionData(current)) === stableJson(data);
    } catch {
      return false;
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
   * True for the roles that render as a document image in the UI (any role of
   * any `DOCUMENT_IMAGE_SLOTS` entry). Generic attachments (role omitted) are
   * untouched by the image constraints.
   */
  private isDocumentImageRole(role?: AttachmentRole): boolean {
    return isDocumentImageRole(role);
  }

  /**
   * Refuse a role the secret's type has no image slot for, with a 422
   * `ATTACHMENT_ROLE_NOT_ALLOWED`: `card_front` on a Passport, `front` on a
   * Card, any role on a custom type. A role-less (generic) attachment passes.
   */
  private assertRoleAllowedForType(
    type: { name: string; isSystem?: boolean },
    role?: AttachmentRole | null,
  ): void {
    if (!role) return;
    if (imageSlotFor(type, role)) return;
    const allowed = imageSlotsFor(type).map((slot) => slot.role);
    throw new UnprocessableEntityException({
      code: 'ATTACHMENT_ROLE_NOT_ALLOWED',
      message:
        allowed.length > 0
          ? `The role "${role}" is not an image slot of this secret type; allowed: ${allowed.join(', ')}`
          : `This secret type has no image slots, so an attachment cannot carry the role "${role}"`,
    });
  }

  /**
   * Resolve the card image size cap, in bytes: the `vaultCards.imageMaxBytes`
   * system setting. Its default is `CARD_IMAGE_MAX_BYTES` (5 MB when unset or
   * invalid), so an operator who set the variable sees no change until an admin
   * saves another value. A stored value that is not a positive integer is
   * ignored by the settings read, never obeyed (NaN would disable the check).
   */
  private async getCardImageMaxBytes(): Promise<number> {
    const { imageMaxBytes } = await this.systemSettings.getNamespace<{ imageMaxBytes: number }>('vaultCards');
    return imageMaxBytes;
  }

  /**
   * Read a stored object back from the storage provider far enough to answer
   * two questions: what its leading bytes are, and — when asked — what it
   * actually weighs.
   *
   * Why the size half exists: `ObjectsService.simpleUpload` — the endpoint the
   * card UI uploads through — writes `size: BigInt(0)` with a comment saying
   * post-processing will fill it in, and no processor ever does. So for every
   * real card image the recorded size is 0, and a plain `size > max` check
   * would pass 100% of uploads while reading like a working limit.
   *
   * Why the header half exists: the `mimeType` column holds whatever
   * `Content-Type` the client declared at upload time. Nothing has ever checked
   * it against the bytes. The header is what lets the caller disagree.
   *
   * Both halves share ONE bounded read, and the read is bounded twice over:
   *   - `measureSize: false` stops as soon as the header is in hand, which is
   *     the first chunk in every realistic case.
   *   - `measureSize: true` stops one byte past `limitBytes`; we only need to
   *     know whether the object is over, not how far over. Worst-case transfer
   *     is `limitBytes + 1`, never the whole object.
   */
  private async readStoredObjectPrefix(
    storageKey: string,
    limitBytes: number,
    measureSize: boolean,
  ): Promise<{ header: Buffer; size: number }> {
    let stream: Readable;

    try {
      stream = await this.storageProvider.download(storageKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Cannot read storage object ${storageKey} to verify it: ${message}`,
      );
      // Fail closed. An object we cannot read is not one we should be stamping
      // onto a card: the attachment would render as a broken image anyway, so
      // rejecting here is the correct outcome and not merely the safe one.
      throw new BadRequestException(
        'This file could not be read from storage, so it cannot be attached',
      );
    }

    let total = 0;
    const headerChunks: Buffer[] = [];
    let headerBytes = 0;

    try {
      for await (const chunk of stream) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        total += buf.length;

        if (headerBytes < IMAGE_SIGNATURE_HEADER_BYTES) {
          headerChunks.push(buf);
          headerBytes += buf.length;
        }

        const haveHeader = headerBytes >= IMAGE_SIGNATURE_HEADER_BYTES;

        // Nothing left to learn: the caller trusts the recorded size, so the
        // header was the only reason to open the stream at all.
        if (!measureSize && haveHeader) {
          break;
        }

        if (measureSize && total > limitBytes) {
          break;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed while reading storage object ${storageKey}: ${message}`,
      );
      throw new BadRequestException(
        'This file could not be read from storage, so it cannot be attached',
      );
    } finally {
      stream.destroy();
    }

    return {
      header: Buffer.concat(headerChunks).subarray(
        0,
        IMAGE_SIGNATURE_HEADER_BYTES,
      ),
      size: total,
    };
  }

  /**
   * Enforce the document image constraints on a StorageObject before it is
   * linked: a declared mime type from a fixed allowlist, a size cap, and — the
   * part that makes the other two mean something — a magic-number check that
   * the bytes are actually one of the accepted formats.
   *
   * The signature check runs on EVERY card image, including one whose recorded
   * size is trustworthy. Skipping it there would leave the resumable
   * `/upload/init` path (which does record a real size) as an unguarded way in,
   * and a control with a documented bypass is not a control. The cost is one
   * `download` call whose stream is destroyed as soon as the first chunk lands.
   */
  private async enforceDocumentImageConstraints(
    storageObject: { mimeType: string; size: bigint | number; storageKey: string },
    secretId: string,
    role: AttachmentRole,
  ): Promise<void> {
    // Card faces keep their historical wording; every other document role
    // gets the same rule under a neutral noun.
    const noun = role === 'card_front' || role === 'card_back' ? 'Card images' : 'Document images';
    const kind = noun === 'Card images' ? 'card image' : 'document image';

    // Normalize `image/jpeg; charset=binary` and casing before comparing.
    const mimeType = (storageObject.mimeType ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();

    if (!CARD_IMAGE_MIME_TYPES.includes(mimeType)) {
      this.logger.warn(
        `Rejected ${role} attachment on secret ${secretId}: ` +
          `mime type "${storageObject.mimeType}" is not an accepted ${kind} type`,
      );
      throw new BadRequestException(
        `${noun} must be one of ${CARD_IMAGE_MIME_TYPES.join(', ')}; ` +
          `received "${storageObject.mimeType}"`,
      );
    }

    const maxBytes = await this.getCardImageMaxBytes();
    const recordedSize = Number(storageObject.size ?? 0);

    // A recorded size of 0 means "unknown", not "empty" — see
    // readStoredObjectPrefix for why. Trust the recorded value when the upload
    // path supplied one (the resumable /upload/init path does), and measure
    // from the stream only when it did not. Either way the stream is opened,
    // because the signature check needs the leading bytes.
    const { header, size: streamedSize } = await this.readStoredObjectPrefix(
      storageObject.storageKey,
      maxBytes,
      recordedSize <= 0,
    );

    const actualSize = recordedSize > 0 ? recordedSize : streamedSize;

    if (actualSize > maxBytes) {
      this.logger.warn(
        `Rejected ${role} attachment on secret ${secretId}: ` +
          `${actualSize} bytes exceeds the ${maxBytes} byte ${kind} limit`,
      );
      throw new BadRequestException(
        `${noun} must be ${maxBytes} bytes or smaller`,
      );
    }

    const detected = detectImageType(header);

    // Fail closed on "cannot tell". A header too short to classify, or one that
    // matches no accepted signature, is rejected on the same footing as an
    // object we could not read at all — consistent with the read-back failure
    // above, and the only safe reading of an unrecognised byte stream.
    if (detected === null) {
      this.logger.warn(
        `Rejected ${role} attachment on secret ${secretId}: ` +
          `declared "${mimeType}" but the file's leading bytes match no accepted ` +
          `image signature`,
      );
      throw new BadRequestException(
        `This file is not a valid ${CARD_IMAGE_MIME_TYPES.join(', ')} image; ` +
          `its contents do not match any accepted image format`,
      );
    }

    if (!isDeclaredTypeConsistent(detected, mimeType)) {
      this.logger.warn(
        `Rejected ${role} attachment on secret ${secretId}: ` +
          `declared "${mimeType}" but the file's contents are ${detected}`,
      );
      throw new BadRequestException(
        `This file is declared as "${mimeType}" but its contents are ` +
          `${detected}; the declared type must match the actual file`,
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
    const storageObject = await this.orgDb.storageObject.findUnique({
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
      /** Recomputed `secrets.origins`, written in the same transaction; omit to leave them. */
      origins?: string[];
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

    if (params.origins !== undefined) {
      await tx.secret.update({ where: { id: secretId }, data: { origins: params.origins } });
    }

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
      select: { storageObjectId: true, orgId: true, role: true, label: true },
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
      orgId: string;
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
        (a: {
          storageObjectId: string;
          orgId: string;
          role: string | null;
          label: string | null;
        }) => ({
          secretId,
          secretVersionId: targetVersionId,
          // Same storage object: the blob is shared between versions, and the
          // refcount-aware unlink below is what keeps it alive.
          storageObjectId: a.storageObjectId,
          orgId: a.orgId,
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
    await this.auditLog.record({ actorUserId: userId, action, targetType: 'secret', targetId, meta });
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

    const data = this.prepareData(secretType, dto.data as Record<string, unknown>);

    // Check name uniqueness per user
    const existing = await this.prisma.secret.findFirst({
      where: { name: dto.name, createdById: userId },
    });
    if (existing) {
      throw new ConflictException(`A secret named "${dto.name}" already exists`);
    }

    // Encrypt the data
    const plaintext = JSON.stringify(data);
    const { ciphertext, iv, authTag } = this.crypto.encrypt(plaintext);

    const origins = computeSecretOrigins(secretType, data);

    // Create secret + first version in a transaction
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const secret = await runInDefaultOrg(this.prisma, async (tx: any) => {
      const created = await tx.secret.create({
        data: {
          name: dto.name,
          description: dto.description,
          typeId: dto.typeId,
          createdById: userId,
          ...(origins !== undefined && { origins }),
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

    this.vaultMetrics?.secretCreated(secretTypeKind(secret.type ?? secretType));
    this.vaultMetrics?.secretVersionCreated('create');

    this.logger.log(`Secret created: ${secret.id}`);

    // Return with decrypted values attached
    return {
      ...secret,
      values: data,
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
    const { page, pageSize, typeId, search, agentAccess, sortBy, sortOrder } = query;

    const canReadAny = userPermissions.includes(PERMISSIONS.SECRETS_READ_ANY);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      ...(canReadAny ? {} : { createdById: userId }),
      ...(typeId ? { typeId } : {}),
      ...(agentAccess ? { agentAccess } : {}),
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

    const secret = await this.orgDb.secret.findUnique({
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

    // Fetch current type for validation if data is changing, and the current
    // version to tell whether the data changed.
    const existingSecret = await this.prisma.secret.findUnique({
      where: { id },
      include: {
        type: true,
        versions: { where: { isCurrent: true }, take: 1, select: { encryptedData: true, iv: true, authTag: true } },
      },
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
    let newData: Record<string, unknown> | undefined;

    if (dto.data !== undefined) {
      newData = this.prepareData(existingSecret.type, dto.data as Record<string, unknown>);

      // A new version only when the data changed: identical values (key order
      // aside; arrays such as a `keyvalue` value compare entry by entry) keep
      // the current version.
      if (!this.isCurrentData(existingSecret.versions?.[0], newData)) {
        const plaintext = JSON.stringify(newData);
        newEncrypted = this.crypto.encrypt(plaintext);
      }
    }

    let carriedAttachments = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const secret = await runInDefaultOrg(this.prisma, async (tx: any) => {
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
          origins: computeSecretOrigins(existingSecret.type, newData),
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

    if (newEncrypted) this.vaultMetrics?.secretVersionCreated('update');

    this.logger.log(`Secret updated: ${id}`);

    // Return with decrypted current data
    return this.findOne(id, userId, userPermissions);
  }

  /**
   * Allow (`fill`) or forbid (`none`) agents to use a secret. Authorization
   * mirrors `update`. Only a `Credential`, `Card` or `Identity` system type may be
   * `fill`. `allowedOrigins` (Identity only) replaces the exact origins its
   * sensitive fields may be filled on. Stamps `agentAccessChangedAt` when the
   * access changes. Audits ids, values and an origin count only.
   */
  async updateAgentAccess(
    id: string,
    agentAccess: 'none' | 'fill',
    userId: string,
    userPermissions: string[],
    allowedOrigins?: string[],
    ownerSession = false,
  ) {
    const existing = await this.getSecretWithAuthCheck(
      id,
      userId,
      PERMISSIONS.SECRETS_WRITE,
      userPermissions,
    );

    if (agentAccess === 'fill' && !isAgentOpenableType(existing.type)) {
      throw new UnprocessableEntityException({
        code: 'AGENT_ACCESS_UNSUPPORTED_TYPE',
        message: 'Only a Credential, Card or Identity secret can be opened to agents',
      });
    }

    // ADR-0003: a card or an identity item is opened (or its allowed origins changed) only by the
    // owner signed in to Vault, never by a token. Closing one narrows access and needs no session.
    const sessionOnly =
      allowedOrigins !== undefined ||
      (agentAccess === 'fill' && (isSystemTypeNamed(existing.type, 'Card') || isSystemTypeNamed(existing.type, 'Identity')));
    if (sessionOnly && !ownerSession) {
      throw new ForbiddenException({
        code: 'OWNER_SESSION_REQUIRED',
        message: 'Sign in to Vault to change what agents may do with this item',
      });
    }

    let origins: string[] | undefined;
    if (allowedOrigins !== undefined) {
      if (!isSystemTypeNamed(existing.type, 'Identity')) {
        throw new BadRequestException('allowedOrigins applies to an Identity secret only');
      }
      const normalized = new Set<string>();
      for (const raw of allowedOrigins) {
        const origin = normalizeOrigin(raw);
        if (!origin) throw new BadRequestException('allowedOrigins holds an invalid https origin');
        normalized.add(origin);
      }
      origins = [...normalized].sort();
    }

    const from = (existing as { agentAccess?: string }).agentAccess ?? 'none';
    const previousOrigins: string[] = (existing as { agentOrigins?: string[] }).agentOrigins ?? [];
    const originsChanged = origins !== undefined && origins.join(' ') !== [...previousOrigins].sort().join(' ');

    if (from !== agentAccess || originsChanged) {
      await runInDefaultOrg(this.prisma, async (tx: any) =>
        tx.secret.update({
          where: { id },
          data: {
            ...(from !== agentAccess ? { agentAccess, agentAccessChangedAt: new Date() } : {}),
            ...(originsChanged ? { agentOrigins: origins } : {}),
          },
        }),
      );

      await this.createAuditEvent(userId, 'secret.agent_access.update', id, {
        secretId: id,
        from,
        to: agentAccess,
        ...(originsChanged ? { allowedOrigins: origins!.length } : {}),
      });
    }

    return this.findOne(id, userId, userPermissions);
  }

  /**
   * The secret `id` of `userId` when it is opened to agents and is the system type `typeName`,
   * else `null`. Missing, foreign, closed and other-type secrets are indistinguishable. For the
   * card and identity agent routes (ADR-0003).
   */
  async findAgentOpenedSecret(userId: string, id: string, typeName: AgentOpenableTypeName) {
    const secret = await this.prisma.secret.findFirst({
      where: { id, createdById: userId, agentAccess: 'fill' },
      include: { type: true },
    });
    if (!secret || !isSystemTypeNamed(secret.type, typeName)) return null;
    return secret;
  }

  /** The caller's secrets of the system type `typeName` opened to agents, by name (ADR-0003). */
  async listAgentOpenedSecrets(userId: string, typeName: AgentOpenableTypeName) {
    return this.prisma.secret.findMany({
      where: { createdById: userId, agentAccess: 'fill', type: { name: typeName, isSystem: true } },
      include: { type: true },
      orderBy: { name: 'asc' },
      take: 100,
    });
  }

  /**
   * Whether `values` (the decrypted current data of a secret of `type`) carry a usable TOTP seed:
   * a Credential with a non-empty `totp` that parses. Pure; no I/O. Callers holding only list
   * rows cannot ask this (lists are not decrypted).
   */
  hasTotp(
    type: { name?: string | null; isSystem?: boolean | null } | null | undefined,
    values: Record<string, unknown> | null | undefined,
  ): boolean {
    if (!isAgentAccessibleType(type)) return false;
    const raw = values?.totp;
    return typeof raw === 'string' && raw.trim() !== '' && parseTotpSecret(raw) !== null;
  }

  /**
   * The current TOTP code of a Credential, computed server-side from its stored seed. The seed
   * is never returned. 404 (the same message as a missing secret) when the secret is missing,
   * is not a Credential, or has no usable `totp`.
   *
   * No authorization and no audit: the caller has already decided the actor may use the secret
   * (the route checks `secrets:read` and ownership; the agent API checks `agentAccess: fill`)
   * and audits its own action. Pass the secret row (with `type`) or its id.
   */
  async generateTotpForSecret(
    secretOrId: string | { id: string; type?: { name?: string | null; isSystem?: boolean | null } | null },
    nowMs: number = Date.now(),
  ): Promise<TotpCode> {
    const id = typeof secretOrId === 'string' ? secretOrId : secretOrId.id;
    const row = await this.prisma.secret.findUnique({
      where: { id },
      include: { type: true, versions: { where: { isCurrent: true } } },
    });
    const version = row?.versions?.[0];
    if (!row || !version || !isAgentAccessibleType(row.type)) {
      throw new NotFoundException('Secret not found');
    }
    const raw = this.decryptVersionData(version).totp;
    const parsed = typeof raw === 'string' ? parseTotpSecret(raw) : null;
    if (!parsed) throw new NotFoundException('Secret not found');
    return generateTotp(parsed, nowMs);
  }

  /**
   * `POST /api/secrets/:id/totp`: authorize like `findOne` (`secrets:read`, owner or
   * `secrets:read_any`), return the current code and audit `secret.totp.read` (secret id only;
   * never the code or the seed).
   */
  async readTotp(id: string, userId: string, userPermissions: string[]): Promise<TotpCode> {
    await this.getSecretWithAuthCheck(id, userId, PERMISSIONS.SECRETS_READ, userPermissions);
    const result = await this.generateTotpForSecret(id);
    await this.createAuditEvent(userId, 'secret.totp.read', id, { secretId: id });
    return result;
  }

  /**
   * The secret `id` of `userId` when agents may use it, else `null`. A missing
   * secret, someone else's secret, `agentAccess: none` and a non-Credential type
   * are indistinguishable, so nothing leaks. For the agent API (fill, listing).
   */
  async findAgentAccessibleSecret(userId: string, id: string) {
    const secret = await this.prisma.secret.findFirst({
      where: { id, createdById: userId, agentAccess: 'fill' },
      include: { type: true },
    });
    if (!secret || !isAgentAccessibleType(secret.type)) return null;
    return secret;
  }

  /**
   * The caller's agent-accessible Credentials whose origins match `origin`, exact matches first.
   *
   * Exact: the GIN index (`origins @> ARRAY[origin]`). Site (same registrable domain): the
   * Public Suffix List cannot be expressed in SQL, so candidates are narrowed with
   * `EXISTS (unnest(origins) LIKE '%<registrable domain>' )` (host suffix; over-matches
   * are removed) and verified in JS with `matchOrigin`. Nothing extra is stored and nothing is
   * decrypted; `username` is read from no column, so it is `null` here (callers needing it
   * use `findAgentAccessibleSecret` + decrypt). Returns `[]` for an invalid origin.
   */
  async findCredentialsByOrigin(userId: string, origin: string): Promise<CredentialOriginMatch[]> {
    const want = normalizeOrigin(origin);
    if (!want) return [];
    const site = registrableDomainOfOrigin(want);
    const base = {
      createdById: userId,
      agentAccess: 'fill' as const,
      type: { name: 'Credential', isSystem: true },
    };
    const candidates = new Map<string, { id: string; name: string; origins: string[] }>();
    const exact = await this.prisma.secret.findMany({
      where: { ...base, origins: { has: want } },
      select: { id: true, name: true, origins: true },
    });
    for (const row of exact) candidates.set(row.id, row);
    if (site) {
      const like = `%${site.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const ids = (await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT s.id FROM secrets s
        WHERE s.created_by_id = ${userId}::uuid
          AND s.agent_access = 'fill'
          AND EXISTS (SELECT 1 FROM unnest(s.origins) o WHERE o LIKE ${like})`).map((r) => r.id);
      const missing = ids.filter((id) => !candidates.has(id));
      if (missing.length > 0) {
        const rows = await this.prisma.secret.findMany({
          where: { ...base, id: { in: missing } },
          select: { id: true, name: true, origins: true },
        });
        for (const row of rows) candidates.set(row.id, row);
      }
    }
    const out: CredentialOriginMatch[] = [];
    for (const row of candidates.values()) {
      const m = matchOrigin(want, row.origins);
      if (m) out.push({ id: row.id, name: row.name, username: null, origins: row.origins, matchKind: m.matchKind });
    }
    return out.sort(
      (a, b) =>
        (a.matchKind === b.matchKind ? 0 : a.matchKind === 'exact' ? -1 : 1) || a.name.localeCompare(b.name),
    );
  }

  /**
   * Throws 404 unless `secret` is open to agents (`fill` on a Credential).
   * The same 404 as a missing secret.
   */
  assertAgentAccessible(secret: AgentAccessCandidate | null | undefined): void {
    if (!secret || secret.agentAccess !== 'fill' || !isAgentAccessibleType(secret.type)) {
      throw new NotFoundException('Secret not found');
    }
  }

  // ---------------------------------------------------------------------------
  // Agent API support (E14.6). No authorization and no audit of the agent action: the agent
  // service has already decided the caller may use the secret and audits its own call.
  // ---------------------------------------------------------------------------

  /**
   * The decrypted current values of a secret. For the agent API only, which returns ONE field of
   * the result and never the record. 404 when the secret has no current version.
   */
  async readCurrentValues(secretId: string): Promise<Record<string, unknown>> {
    const version = await this.prisma.secretVersion.findFirst({ where: { secretId, isCurrent: true } });
    if (!version) throw new NotFoundException('Secret not found');
    return this.decryptVersionData(version);
  }

  /**
   * The non-sensitive facts the agent lookup adds to a match: the `username` field, whether a usable
   * TOTP seed exists and when the secret last changed. Decrypts each current version once and
   * returns only these three; no sensitive field leaves this method. Ids without a Credential
   * are absent from the map.
   */
  async describeAgentCredentials(
    ids: string[],
  ): Promise<Map<string, { username: string | null; hasTotp: boolean; updatedAt: string }>> {
    const out = new Map<string, { username: string | null; hasTotp: boolean; updatedAt: string }>();
    if (ids.length === 0) return out;
    const rows = await this.prisma.secret.findMany({
      where: { id: { in: ids } },
      include: { type: true, versions: { where: { isCurrent: true } } },
    });
    for (const row of rows) {
      const version = row.versions?.[0];
      if (!version || !isAgentAccessibleType(row.type)) continue;
      const values = this.decryptVersionData(version);
      out.set(row.id, {
        username: typeof values.username === 'string' ? values.username : null,
        hasTotp: this.hasTotp(row.type, values),
        updatedAt: new Date(row.updatedAt).toISOString(),
      });
    }
    return out;
  }

  /**
   * Create a Credential for the agent API: owned by `userId`, opened to agents (`agentAccess: fill`,
   * `agentAccessChangedAt` now), origins derived from `values.url`. `values` is validated against
   * the Credential type like any create. 409 when the user already has a secret of that name.
   * Returns ids and origins only.
   */
  async createAgentCredential(
    userId: string,
    input: { name: string; values: Record<string, unknown> },
  ): Promise<{ id: string; name: string; origins: string[] }> {
    const type = await this.prisma.secretType.findFirst({ where: { name: 'Credential', isSystem: true } });
    if (!type) throw new NotFoundException('Secret type not found');

    const data = this.prepareData(type, input.values);

    const existing = await this.prisma.secret.findFirst({ where: { name: input.name, createdById: userId } });
    if (existing) throw new ConflictException(`A secret named "${input.name}" already exists`);

    const { ciphertext, iv, authTag } = this.crypto.encrypt(JSON.stringify(data));
    const origins = computeSecretOrigins(type, data) ?? [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const secret = await runInDefaultOrg(this.prisma, async (tx: any) => {
      const created = await tx.secret.create({
        data: {
          name: input.name,
          typeId: type.id,
          createdById: userId,
          origins,
          agentAccess: 'fill',
          agentAccessChangedAt: new Date(),
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
      viaAgent: true,
    });
    this.vaultMetrics?.secretCreated(secretTypeKind(secret.type ?? type));
    this.vaultMetrics?.secretVersionCreated('create');

    return { id: secret.id, name: secret.name, origins };
  }

  /**
   * Replace the `password` of a Credential with a new version (rollback stays possible), keeping every
   * other field and recomputing the origins. Returns the new version number. The caller has proved the
   * secret is the user's and open to agents.
   */
  async rotateCredentialPassword(
    secretId: string,
    userId: string,
    password: string,
  ): Promise<{ version: number }> {
    const secret = await this.prisma.secret.findUnique({ where: { id: secretId }, include: { type: true } });
    if (!secret || !isAgentAccessibleType(secret.type)) throw new NotFoundException('Secret not found');

    const current = await this.readCurrentValues(secretId);
    const next = this.prepareData(secret.type, { ...current, password });
    const encrypted = this.crypto.encrypt(JSON.stringify(next));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await runInDefaultOrg(this.prisma, async (tx: any) =>
      this.createNewVersion(tx, {
        secretId,
        encrypted,
        userId,
        origins: computeSecretOrigins(secret.type, next),
      }),
    );

    await this.createAuditEvent(userId, 'secret.update', secretId, {
      name: secret.name,
      dataChanged: true,
      viaAgent: true,
      carriedAttachments: created.carriedAttachments,
    });
    this.vaultMetrics?.secretVersionCreated('update');

    return { version: created.version };
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

    const version = await this.orgDb.secretVersion.findUnique({
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

    const attachments = await this.orgDb.secretAttachment.findMany({
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
    const authorized = await this.getSecretWithAuthCheck(
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
    const rollbackOrigins = computeSecretOrigins(
      authorized.type,
      JSON.parse(plaintext) as Record<string, unknown>,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newVersion = await runInDefaultOrg(this.prisma, async (tx: any) =>
      this.createNewVersion(tx, {
        secretId,
        encrypted: { ciphertext, iv, authTag },
        userId,
        // Restore the TARGET version's files, not the current one's. A rollback
        // that kept the current attachments would show the old card's numbers
        // beside the new card's photos.
        sourceVersionId: oldVersion.id,
        origins: rollbackOrigins,
      }),
    );

    await this.createAuditEvent(userId, 'secret.rollback', secretId, {
      fromVersion: oldVersion.version,
      carriedAttachments: newVersion.carriedAttachments,
    });

    this.vaultMetrics?.secretVersionCreated('rollback');

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

    const renewData = this.prepareData(secret.type, dto.data as Record<string, unknown>);

    const replacements = dto.attachments ?? [];

    if (replacements.length > 0 && !secret.type.allowAttachments) {
      throw new BadRequestException(
        'This secret type does not allow attachments',
      );
    }

    this.assertReplacementsAreDistinct(replacements);

    for (const replacement of replacements) {
      this.assertRoleAllowedForType(secret.type, replacement.role);
    }

    // Validate EVERY replacement before opening the transaction. The card image
    // check streams the object back from the storage provider to read its
    // signature (and, when the recorded size is unknown, to measure it), and
    // holding a write transaction open across a network read is how a lock
    // pile-up starts. Failing here also means a rejected image never reaches the
    // version bump at all.
    const replacementOrgIds = new Map<string, string>();
    for (const replacement of replacements) {
      const storageObject = await this.resolveUsableStorageObject(
        replacement.storageObjectId,
        userId,
        userPermissions,
      );
      replacementOrgIds.set(replacement.storageObjectId, storageObject.orgId);

      if (this.isDocumentImageRole(replacement.role)) {
        await this.enforceDocumentImageConstraints(
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

    const encrypted = this.crypto.encrypt(JSON.stringify(renewData));

    let newVersion: {
      id: string;
      version: number;
      carriedAttachments: number;
      sourceVersionId?: string;
    };

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      newVersion = await runInDefaultOrg(this.prisma, async (tx: any) => {
        const version = await this.createNewVersion(tx, {
          secretId,
          encrypted,
          userId,
          origins: computeSecretOrigins(secret.type, renewData),
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
              orgId: replacementOrgIds.get(r.storageObjectId) as string,
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
      throw this.translateAttachmentConflict(error, replacements[0] ?? {}, secret.type);
    }

    // One event for one user action. The replacements inserted above are NOT
    // also emitted as `secret.attachment.link` rows: a renewal is a single
    // atomic swap, not N independent link calls, and synthesising link events
    // here would double-count against `replacedAttachments` for anyone counting
    // rows to answer "how many files were attached to this secret".
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
    this.vaultMetrics?.secretVersionCreated('renew');

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

    // A role is an image slot of the type, or nothing (a generic attachment).
    this.assertRoleAllowedForType(secret.type, dto.role);

    // Verify the storage object exists and the caller can use it
    const storageObject = await this.resolveUsableStorageObject(
      dto.storageObjectId,
      userId,
      userPermissions,
    );

    // Document images (card faces, passport pages, ID document faces) are
    // rendered as images in the UI and carried forward onto every future
    // version, so the type/size gate belongs here — before the attachment row
    // exists — rather than at render time.
    if (this.isDocumentImageRole(dto.role)) {
      await this.enforceDocumentImageConstraints(
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
      attachment = await runInDefaultOrg(this.prisma, async (tx: any) => {
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
            orgId: storageObject.orgId,
            role: dto.role,
            label: dto.label,
          },
          include: { storageObject: true },
        });
      });
    } catch (error) {
      throw this.translateAttachmentConflict(error, dto, secret.type);
    }

    // Outside the transaction, after it has committed — the same placement every
    // other audit call site in this service uses. Inside it, a failing audit
    // insert would roll back the link the caller just made, which trades a
    // missing log line for lost data.
    //
    // Attaching a photograph of a card is at least as sensitive as removing one,
    // so it gets the mirror of `secret.attachment.unlink`. Identifiers only: the
    // audit trail is queried by support staff with no business reading card
    // data, and audit rows are not encrypted the way a SecretVersion is.
    await this.createAuditEvent(userId, 'secret.attachment.link', secretId, {
      attachmentId: attachment.id,
      storageObjectId: attachment.storageObjectId,
      // Normalised to null rather than left undefined: a generic attachment
      // should read as "no role", not as a key missing from the JSON.
      role: attachment.role ?? null,
      // Attachments are version-scoped, so the secret id alone does not say what
      // changed — this is the version the file was actually stamped onto.
      secretVersionId: attachment.secretVersionId,
    });

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
    type: { name: string; isSystem?: boolean },
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
      // "This card already has a front image", "This passport already has a
      // data page image": the type name and the slot label, in lower case
      // (an all-capital word such as "ID" is kept).
      const slotLabel = imageSlotFor(type, dto.role)?.label ?? dto.role;
      return new ConflictException(
        `This ${documentNoun(type.name)} already has a ${slotLabel.toLowerCase()} image for the current version`,
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

    const attachment = await this.orgDb.secretAttachment.findUnique({
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

    const objectDeleted: boolean = await runInDefaultOrg(
      this.prisma,
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
