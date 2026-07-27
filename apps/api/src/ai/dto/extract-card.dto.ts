import { z } from 'zod';

import { MAX_IMAGE_DATA_URL_LENGTH } from '../ai.constants';

/**
 * A single already-cropped card image, as a base64 data URL.
 *
 * The transport is JSON, not multipart. `apps/web/src/services/api.ts`
 * force-sets `Content-Type: application/json` whenever a body is present, so a
 * multipart endpoint here would be unreachable from the web client.
 *
 * `.max()` runs against the string length: base64 inflates by ~4/3, so this
 * caps a single image at roughly 2 MB. Two of them must fit inside the 8 MiB
 * Fastify `bodyLimit` configured in main.ts (Fastify's 1 MiB default would
 * reject the body with FST_ERR_CTP_BODY_TOO_LARGE before this ever runs).
 */
export const cardImageDataUrlSchema = z
  .string()
  .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/)
  .max(MAX_IMAGE_DATA_URL_LENGTH);

export const extractCardSchema = z.object({
  front: cardImageDataUrlSchema,
  back: cardImageDataUrlSchema.optional(),
});

export type ExtractCardRequest = z.infer<typeof extractCardSchema>;

/**
 * OpenAPI body description.
 *
 * Written by hand rather than via `createZodDto` on purpose: the global
 * nestjs-zod `ZodValidationPipe` would reject a bad data URL as a generic 400
 * BAD_REQUEST, and this endpoint owes the client a distinct
 * `AI_INVALID_IMAGE`. Validation therefore happens explicitly in the service.
 */
export const EXTRACT_CARD_BODY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['front'],
  properties: {
    front: {
      type: 'string',
      description: 'Cropped front-of-card image as a base64 data URL.',
      example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
    },
    back: {
      type: 'string',
      description: 'Optional cropped back-of-card image as a base64 data URL.',
    },
  },
};
