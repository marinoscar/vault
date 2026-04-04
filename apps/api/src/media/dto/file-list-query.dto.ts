import { z } from 'zod';

export const fileListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  sortBy: z.enum(['createdAt', 'name', 'updatedAt']).default('updatedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  mimeTypePrefix: z.string().optional(),
});

export type FileListQueryDto = z.infer<typeof fileListQuerySchema>;
