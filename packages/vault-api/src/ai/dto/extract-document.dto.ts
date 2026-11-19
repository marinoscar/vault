import { DOCUMENT_SCAN_SLOTS, SCANNABLE_DOCUMENT_TYPES } from '@marinoscar/vault-contract/secrets';

/**
 * OpenAPI body description of `POST /api/secrets/documents/extract`.
 *
 * Hand-written like `EXTRACT_CARD_BODY_SCHEMA`: the global validation pipe
 * would answer a bad data URL with a generic 400, and this endpoint owes the
 * client `AI_INVALID_IMAGE`. The body is parsed in `DocumentExtractService`
 * with `extractDocumentRequestSchema` of the contract.
 */
export const EXTRACT_DOCUMENT_BODY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['documentType', 'images'],
  properties: {
    documentType: {
      type: 'string',
      enum: [...SCANNABLE_DOCUMENT_TYPES],
      description: '`passport` (needs `images.data_page`) or `id_document` (needs `images.front`).',
    },
    images: {
      type: 'object',
      description:
        'Full (uncropped) photos as base64 data URLs (JPEG, PNG or WebP). A passport takes `data_page` and an optional `back`; an ID document takes `front` and an optional `back`.',
      properties: Object.fromEntries(
        DOCUMENT_SCAN_SLOTS.map((slot) => [
          slot,
          { type: 'string', example: slot === 'back' ? undefined : 'data:image/jpeg;base64,/9j/4AAQSkZJRg...' },
        ]),
      ),
    },
  },
};
