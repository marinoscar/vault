import { z } from 'zod';

/**
 * Media folders and files: the create, rename, link and list schemas.
 *
 * @packageDocumentation
 */

/** Body of `POST /api/media/folders`. @stability experimental */
export const createFolderSchema = z.object({
  name: z.string().min(1).max(255),
});

/** Body of `PATCH /api/media/folders/:folderId`. @stability experimental */
export const updateFolderSchema = z.object({
  name: z.string().min(1).max(255),
});

/** Query of `GET /api/media/folders`. @stability experimental */
export const folderListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  sortBy: z.enum(['createdAt', 'name', 'updatedAt']).default('updatedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

/** @stability experimental */
export type FolderListQuery = z.infer<typeof folderListQuerySchema>;

/** Query of the media file list. @stability experimental */
export const fileListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  sortBy: z.enum(['createdAt', 'name', 'updatedAt']).default('updatedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  mimeTypePrefix: z.string().optional(),
});

/** Body of `POST /api/media/folders/:folderId/files`. @stability experimental */
export const linkFileSchema = z.object({
  storageObjectId: z.string().uuid(),
});

/** Body of `PATCH /api/media/folders/:folderId/files/:fileId`. @stability experimental */
export const renameFileSchema = z.object({
  name: z.string().min(1).max(255),
});
