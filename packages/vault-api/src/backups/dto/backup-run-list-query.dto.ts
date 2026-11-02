import { createZodDto } from 'nestjs-zod';
import {
  backupRunListQuerySchema,
  type BackupRunListQuery,
} from '@marinoscar/vault-contract/backups';

export { backupRunListQuerySchema };
export type { BackupRunListQuery };

export class BackupRunListQueryDto extends createZodDto(backupRunListQuerySchema) {}
