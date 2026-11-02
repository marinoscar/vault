import { createZodDto } from 'nestjs-zod';
import { renameFileSchema } from '@marinoscar/vault-contract/media';

export { renameFileSchema };

export class RenameFileDto extends createZodDto(renameFileSchema) {}
