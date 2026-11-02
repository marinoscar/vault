import { StorageObjectStatus } from '@prisma/client';

/**
 * Storage object as returned inside a secret attachment.
 *
 * Mirrors `storage/objects/dto/object-response.dto.ts`: `size` is a BigInt in
 * the database and MUST be serialized as a string. Fastify's serializer throws
 * `TypeError: Do not know how to serialize a BigInt` on a raw row, and there is
 * deliberately no global `BigInt.prototype.toJSON` in this app (adding one
 * would silently change the shape of the existing storage endpoints).
 */
export interface AttachmentStorageObjectDto {
  id: string;
  name: string;
  size: string; // BigInt as string
  mimeType: string;
  status: StorageObjectStatus;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AttachmentResponseDto {
  id: string;
  secretId: string;
  secretVersionId: string;
  storageObjectId: string;
  role: string | null;
  label: string | null;
  createdAt: Date;
  storageObject: AttachmentStorageObjectDto | null;
}
