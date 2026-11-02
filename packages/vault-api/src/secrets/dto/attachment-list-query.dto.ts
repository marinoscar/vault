import { createZodDto } from 'nestjs-zod';
import { attachmentListQuerySchema } from '@marinoscar/vault-contract/secrets';

export { attachmentListQuerySchema };

export class AttachmentListQueryDto extends createZodDto(
  attachmentListQuerySchema,
) {}
