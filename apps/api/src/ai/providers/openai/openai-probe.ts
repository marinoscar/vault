// =============================================================================
// OpenAI Connectivity Probe
// =============================================================================
//
// The smallest request that still exercises every part of the contract card
// extraction depends on. `/v1/models` deliberately is NOT used: it lists model
// IDs but exposes no capability metadata, so it can tell you a name resolves
// and nothing about whether that model will accept an image or honour a
// json_schema. The only way to know is to try, so this tries - once, with the
// cheapest possible payload.

export const OPENAI_PROBE_SCHEMA_NAME = 'connectivity_probe';

/**
 * A 1x1 fully transparent PNG, inline.
 *
 * Constructed here as a constant rather than fetched or read from disk: the
 * probe must not depend on network egress to anywhere except the provider, and
 * must not depend on a file being shipped in the container image.
 *
 * 70 bytes. Verified to be a structurally valid PNG (signature, IHDR with
 * width=1 height=1, IEND) - a malformed image would make a perfectly capable
 * model return a 400 and be misreported as "this model cannot read images".
 */
export const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export const ONE_PIXEL_PNG_DATA_URL = `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`;

/**
 * Trivial strict schema. Same `strict: true` structured-output machinery the
 * card schema uses, with one boolean property, so a model that cannot do
 * structured outputs fails here for the same reason it would fail a real
 * extraction.
 */
export const OPENAI_PROBE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok'],
  properties: {
    ok: {
      type: 'boolean',
      description: 'Always true.',
    },
  },
} as const;

/**
 * Build the probe request body.
 *
 * `temperature: 0` is included ON PURPOSE even though the probe does not care
 * about determinism: it makes the probe fail exactly where a real extraction
 * would fail, which means the adaptive-parameter retry is exercised by the
 * verify button instead of being discovered in production by a user whose card
 * import silently stopped working.
 *
 * No token-limit parameter is sent. `max_tokens` and `max_completion_tokens`
 * are accepted by different model families and guessing wrong turns a working
 * model into a 400; omitting both is always valid, and the response is one
 * small JSON object anyway.
 */
export function buildProbeRequestBody(model: string): Record<string, unknown> {
  return {
    model,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Reply with {"ok": true}. Do not describe the image.',
          },
          {
            type: 'image_url',
            image_url: { url: ONE_PIXEL_PNG_DATA_URL, detail: 'low' },
          },
        ],
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: OPENAI_PROBE_SCHEMA_NAME,
        strict: true,
        schema: OPENAI_PROBE_JSON_SCHEMA,
      },
    },
  };
}
