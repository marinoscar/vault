import { createZodDto } from 'nestjs-zod';
import { createSecretSchema } from '@marinoscar/vault-contract/secrets';

export { createSecretSchema };

export class CreateSecretDto extends createZodDto(createSecretSchema) {}
