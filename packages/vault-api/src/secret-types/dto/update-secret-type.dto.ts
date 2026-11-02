import { createZodDto } from 'nestjs-zod';
import { updateSecretTypeSchema } from '@marinoscar/vault-contract/secret-types';

export { updateSecretTypeSchema };

export class UpdateSecretTypeDto extends createZodDto(updateSecretTypeSchema) {}
