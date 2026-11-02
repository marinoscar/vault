import { createZodDto } from 'nestjs-zod';
import {
  renewAttachmentSchema,
  renewSecretSchema,
  type RenewAttachmentInput,
} from '@marinoscar/vault-contract/secrets';

export { renewAttachmentSchema, renewSecretSchema };
export type { RenewAttachmentInput };

export class RenewSecretDto extends createZodDto(renewSecretSchema) {}
