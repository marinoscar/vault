import { createZodDto } from 'nestjs-zod';
import { updateSecretSchema } from '@marinoscar/vault-contract/secrets';

export { updateSecretSchema };

export class UpdateSecretDto extends createZodDto(updateSecretSchema) {}
