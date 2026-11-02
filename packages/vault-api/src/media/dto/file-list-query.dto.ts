import { fileListQuerySchema } from '@marinoscar/vault-contract/media';
import type { z } from 'zod';

export { fileListQuerySchema };

export type FileListQueryDto = z.infer<typeof fileListQuerySchema>;
