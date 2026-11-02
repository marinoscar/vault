import { createZodDto } from 'nestjs-zod';
import { createFolderSchema } from '@marinoscar/vault-contract/media';

export { createFolderSchema };

export class CreateFolderDto extends createZodDto(createFolderSchema) {}
