import { createZodDto } from 'nestjs-zod';
import { linkFileSchema } from '@marinoscar/vault-contract/media';

export { linkFileSchema };

export class LinkFileDto extends createZodDto(linkFileSchema) {}
