import { createZodDto } from 'nestjs-zod';
import {
  createSecretTypeSchema,
  fieldDefinitionSchema,
  secretTypeFieldsSchema,
  type FieldDefinition,
} from '@marinoscar/vault-contract/secret-types';

export { createSecretTypeSchema, fieldDefinitionSchema, secretTypeFieldsSchema };
export type { FieldDefinition };

export class CreateSecretTypeDto extends createZodDto(createSecretTypeSchema) {}
