import { createZodDto } from 'nestjs-zod';
import { updateAgentAccessSchema } from '@marinoscar/vault-contract/secrets';

export { updateAgentAccessSchema };

export class UpdateAgentAccessDto extends createZodDto(updateAgentAccessSchema) {}
