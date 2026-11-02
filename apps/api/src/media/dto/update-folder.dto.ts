import { createZodDto } from 'nestjs-zod';
import { updateFolderSchema } from '@marinoscar/vault-contract/media';

export { updateFolderSchema };

export class UpdateFolderDto extends createZodDto(updateFolderSchema) {}
