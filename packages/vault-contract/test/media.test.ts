import { describe, expect, it } from 'vitest';

import { createFolderSchema, fileListQuerySchema, folderListQuerySchema, linkFileSchema, renameFileSchema, updateFolderSchema } from '../src/media/index.js';

describe('media schemas', () => {
  it('requires a non-empty name of at most 255 characters', () => {
    for (const schema of [createFolderSchema, updateFolderSchema, renameFileSchema]) {
      expect(schema.safeParse({ name: 'a' }).success).toBe(true);
      expect(schema.safeParse({ name: '' }).success).toBe(false);
      expect(schema.safeParse({ name: 'a'.repeat(256) }).success).toBe(false);
    }
  });

  it('links a file by storage object id', () => {
    expect(linkFileSchema.safeParse({ storageObjectId: '3f2b8c1e-6d4a-4b7e-9c10-2a5d7e8f9a0b' }).success).toBe(true);
    expect(linkFileSchema.safeParse({ storageObjectId: 'nope' }).success).toBe(false);
  });

  it('defaults list queries', () => {
    expect(folderListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20, sortBy: 'updatedAt', sortOrder: 'desc' });
    expect(fileListQuerySchema.parse({ mimeTypePrefix: 'image/' }).mimeTypePrefix).toBe('image/');
  });
});
