import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Query of `GET /api/admin/backups` (same paging fields as the users list). */
export const backupRunListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type BackupRunListQuery = z.infer<typeof backupRunListQuerySchema>;

export class BackupRunListQueryDto extends createZodDto(backupRunListQuerySchema) {}
