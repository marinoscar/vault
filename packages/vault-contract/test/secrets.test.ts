import { describe, expect, it } from 'vitest';

import {
  attachmentListQuerySchema,
  attachmentResponseSchema,
  cardSummaryQuerySchema,
  createSecretSchema,
  linkAttachmentSchema,
  renewSecretSchema,
  secretListQuerySchema,
  updateSecretSchema,
} from '../src/secrets/index.js';

const uuid = '3f2b8c1e-6d4a-4b7e-9c10-2a5d7e8f9a0b';

describe('secret bodies', () => {
  it('requires a name, a type id and a data record', () => {
    expect(createSecretSchema.safeParse({ name: 'n', typeId: uuid, data: { a: 1 } }).success).toBe(true);
    expect(createSecretSchema.safeParse({ name: '', typeId: uuid, data: {} }).success).toBe(false);
    expect(createSecretSchema.safeParse({ name: 'n', typeId: 'x', data: {} }).success).toBe(false);
    expect(createSecretSchema.safeParse({ name: 'n', typeId: uuid }).success).toBe(false);
  });

  it('lets an update clear the description', () => {
    expect(updateSecretSchema.parse({ description: null }).description).toBeNull();
  });

  it('caps a renewal at twenty attachments', () => {
    const attachment = { storageObjectId: uuid, role: 'card_front' };
    expect(renewSecretSchema.safeParse({ data: {}, attachments: Array(20).fill(attachment) }).success).toBe(true);
    expect(renewSecretSchema.safeParse({ data: {}, attachments: Array(21).fill(attachment) }).success).toBe(false);
    expect(linkAttachmentSchema.safeParse({ storageObjectId: uuid, role: 'card_side' }).success).toBe(false);
  });
});

describe('secret queries', () => {
  it('coerces and defaults paging', () => {
    expect(secretListQuerySchema.parse({ page: '2', pageSize: '50' })).toMatchObject({ page: 2, pageSize: 50, sortBy: 'updatedAt', sortOrder: 'desc' });
    expect(secretListQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(cardSummaryQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(attachmentListQuerySchema.parse({})).toEqual({});
  });
});

describe('attachment response', () => {
  it('carries the object size as a string', () => {
    const row = {
      id: 'a', secretId: 's', secretVersionId: 'v', storageObjectId: 'o', role: null, label: null, createdAt: '2026-01-01T00:00:00.000Z',
      storageObject: { id: 'o', name: 'f.png', size: '1024', mimeType: 'image/png', status: 'ready', metadata: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    };
    expect(attachmentResponseSchema.safeParse(row).success).toBe(true);
    expect(attachmentResponseSchema.safeParse({ ...row, storageObject: { ...row.storageObject, size: 1024 } }).success).toBe(false);
  });
});
