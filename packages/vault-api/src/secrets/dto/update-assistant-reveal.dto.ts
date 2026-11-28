import { createZodDto } from 'nestjs-zod';
import { updateAssistantRevealSchema } from '@marinoscar/vault-contract/secrets';

export { updateAssistantRevealSchema };

export class UpdateAssistantRevealDto extends createZodDto(updateAssistantRevealSchema) {}
