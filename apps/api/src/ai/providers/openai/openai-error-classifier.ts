// =============================================================================
// OpenAI Upstream Error Classification
// =============================================================================
//
// Pure functions, no I/O, no logging. Everything here works off the parsed
// error envelope so it can be unit tested exhaustively against real upstream
// bodies without a network stub.
//
// DESIGN RULE: nothing in this file may branch on a model NAME or a model
// version. There is deliberately no allowlist, no `startsWith('gpt-5')`, no
// family table. Model capabilities are discovered by asking the API and reading
// what it says, because any table written today is a guess about a model that
// does not exist yet. When the error shape is unfamiliar we fall through to
// `bad_request` (which surfaces as "unknown") rather than inventing a cause.

/**
 * The `error` object OpenAI returns on a failure, flattened and made total.
 *
 * Every field is optional upstream and every field has been observed absent, so
 * each one is normalised to `string | null` and callers must cope with null.
 */
export interface OpenAiErrorEnvelope {
  message: string;
  type: string | null;
  code: string | null;
  param: string | null;
}

/**
 * Why an upstream call failed, at the granularity the verify endpoint needs.
 *
 * `bad_request` is the honest "we got a 4xx we do not recognise" bucket. It
 * exists so that an unfamiliar error shape degrades to "unknown" instead of
 * being force-fitted into a specific reason and telling an admin to fix the
 * wrong thing.
 */
export type OpenAiUpstreamReason =
  | 'auth'
  | 'quota'
  | 'rate_limited'
  | 'unavailable'
  | 'model_not_found'
  | 'model_no_image_support'
  | 'model_no_structured_output'
  | 'bad_request';

/**
 * Request parameters the adaptive retry is allowed to drop.
 *
 * These are all sampling / limit knobs: removing one changes the quality or
 * cost of a completion but never its CONTRACT. `model`, `messages` and
 * `response_format` are deliberately absent - dropping `response_format` would
 * silently turn a schema-validated extraction into free text, which is a data
 * integrity problem, not a compatibility fix. If the model cannot do structured
 * outputs that is a hard failure the admin needs to see, not something to paper
 * over.
 *
 * This is not a model allowlist. It is a list of OUR OWN request fields that
 * are safe to omit, and it does not need to change when a new model ships.
 */
export const ADAPTIVE_DROPPABLE_PARAMS: ReadonlySet<string> = new Set([
  'temperature',
  'top_p',
  'max_tokens',
  'max_completion_tokens',
  'frequency_penalty',
  'presence_penalty',
  'logprobs',
  'top_logprobs',
  'seed',
  'n',
  'stop',
]);

/**
 * Error codes OpenAI has used to mean "you sent a parameter I do not accept".
 * Matched case-insensitively, and backed up by a message-text check, because
 * `code` has been observed as `null` on exactly this class of error.
 */
const UNSUPPORTED_PARAM_CODES = new Set([
  'unsupported_parameter',
  'unsupported_value',
  'unknown_parameter',
  'invalid_parameter',
  'parameter_not_supported',
]);

/**
 * Message phrasings that indicate a parameter-level rejection.
 *
 * Broad on purpose: this predicate only decides whether we are ALLOWED to look
 * for a droppable parameter name. The name itself must still be one we actually
 * sent and one that appears in ADAPTIVE_DROPPABLE_PARAMS, so a false positive
 * here cannot cause anything to be dropped.
 */
const UNSUPPORTED_PARAM_MESSAGE =
  /unsupported|unrecognized|unrecognised|unknown (?:parameter|argument)|not supported|does not support|only the default|is not permitted|no longer supported/i;

const MODEL_NOT_FOUND_MESSAGE =
  /(?:the )?model [`'"]?[\w.\-:]+[`'"]? (?:does not exist|is not available|was not found)|do(?:es)? not have access to (?:the )?model|invalid model|unknown model|model_not_found/i;

const STRUCTURED_OUTPUT_MESSAGE =
  /response_format|json_schema|structured output/i;

const IMAGE_SUPPORT_MESSAGE =
  /image_url|image input|image content|invalid content type|does not support image|vision (?:is )?(?:not|un)supported|only supports text/i;

const QUOTA_MESSAGE =
  /quota|billing|payment|hard limit|spending limit|credit balance/i;

/**
 * Parse an upstream error body into a total envelope.
 *
 * Never throws. A body that is not JSON, or is JSON without an `error` object
 * (an HTML error page from a proxy, for example), yields an envelope with an
 * empty message, which classifies as `bad_request` -> "unknown".
 */
export function parseErrorEnvelope(bodyText: string): OpenAiErrorEnvelope {
  const empty: OpenAiErrorEnvelope = {
    message: '',
    type: null,
    code: null,
    param: null,
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return empty;
  }

  const error = (parsed as any)?.error;
  if (!error || typeof error !== 'object') {
    return empty;
  }

  return {
    message: typeof error.message === 'string' ? error.message : '',
    type: typeof error.type === 'string' ? error.type : null,
    code: typeof error.code === 'string' ? error.code : null,
    param: typeof error.param === 'string' ? error.param : null,
  };
}

/**
 * Map an upstream HTTP failure to a reason.
 *
 * Order is load-bearing:
 *   1. credential   - 401/403 is unambiguous and must never be confused with
 *                     anything else, since it is the one case the browser must
 *                     not see as a 401
 *   2. throttling   - 429, split into "no money left" and "too fast"
 *   3. server side  - 5xx is theirs, not ours
 *   4. model name   - checked BEFORE the capability probes, because an unknown
 *                     model cannot have told us anything about its capabilities
 *   5. capabilities - structured outputs, then image input
 *   6. bad_request  - honest fallback
 *
 * Step 4 before step 5 is the distinction the verify endpoint exists to make:
 * a typo'd model name and a text-only model both surface as a 4xx, and telling
 * an admin "this model cannot read images" when they actually mistyped the name
 * sends them off to change the wrong setting.
 */
export function classifyUpstreamError(
  status: number,
  envelope: OpenAiErrorEnvelope,
  requestIncludedImage: boolean,
): OpenAiUpstreamReason {
  const code = envelope.code?.toLowerCase() ?? '';
  const type = envelope.type?.toLowerCase() ?? '';
  const message = envelope.message ?? '';

  // 1. Credential.
  if (status === 401 || status === 403 || code === 'invalid_api_key') {
    return 'auth';
  }

  // 2. Throttling. `insufficient_quota` is a 429 that no amount of waiting
  // fixes, so it must not be reported as "try again shortly".
  if (
    code === 'insufficient_quota' ||
    type === 'insufficient_quota' ||
    code === 'billing_hard_limit_reached'
  ) {
    return 'quota';
  }
  if (status === 429) {
    return QUOTA_MESSAGE.test(message) ? 'quota' : 'rate_limited';
  }

  // 3. Their side.
  if (status >= 500) {
    return 'unavailable';
  }

  // 4. Model name.
  if (
    code === 'model_not_found' ||
    status === 404 ||
    MODEL_NOT_FOUND_MESSAGE.test(message)
  ) {
    return 'model_not_found';
  }

  // 5a. Structured outputs. Checked via `param` first: OpenAI sets it to
  // `response_format` for exactly this failure.
  if (
    rootParam(envelope.param) === 'response_format' ||
    STRUCTURED_OUTPUT_MESSAGE.test(message)
  ) {
    return 'model_no_structured_output';
  }

  // 5b. Image input. Gated on the request actually having carried an image, so
  // a text-only call can never be blamed on vision support.
  if (requestIncludedImage && IMAGE_SUPPORT_MESSAGE.test(message)) {
    return 'model_no_image_support';
  }

  return 'bad_request';
}

/**
 * Decide whether a failure names one of OUR request parameters as unsupported,
 * and if so which one.
 *
 * Returns null unless ALL of the following hold, which is what keeps the
 * adaptive retry from firing on a genuine failure:
 *   - the status is 400 (a parameter complaint is never a 401, 404, 429 or 5xx)
 *   - the error code or message says something is unsupported/unrecognised
 *   - the named parameter is one we actually sent
 *   - that parameter is in ADAPTIVE_DROPPABLE_PARAMS, i.e. removing it cannot
 *     change what the response means
 *
 * The candidate set is derived from the request body rather than scraped out of
 * the message, so an unfamiliar phrasing can only ever cause us to give up, not
 * to strip something load-bearing.
 */
export function detectUnsupportedParameter(
  status: number,
  envelope: OpenAiErrorEnvelope,
  requestBody: Record<string, unknown>,
): string | null {
  if (status !== 400) {
    return null;
  }

  const code = envelope.code?.toLowerCase() ?? '';
  const signalled =
    UNSUPPORTED_PARAM_CODES.has(code) ||
    UNSUPPORTED_PARAM_MESSAGE.test(envelope.message ?? '');

  if (!signalled) {
    return null;
  }

  const candidates = Object.keys(requestBody).filter((key) =>
    ADAPTIVE_DROPPABLE_PARAMS.has(key),
  );
  if (candidates.length === 0) {
    return null;
  }

  // `param` is authoritative when present.
  const named = rootParam(envelope.param);
  if (named && candidates.includes(named)) {
    return named;
  }

  // Otherwise look for a parameter we sent being mentioned by name. Bounded by
  // the candidate list, so this cannot match an arbitrary word.
  const message = envelope.message ?? '';
  return (
    candidates.find((candidate) =>
      new RegExp(`\\b${candidate}\\b`, 'i').test(message),
    ) ?? null
  );
}

/**
 * Whether a chat-completions request body carries image content.
 *
 * Used to gate the `model_no_image_support` classification: blaming vision
 * support for a failure on a request that sent no image would be a lie.
 */
export function requestIncludesImage(body: unknown): boolean {
  const messages = (body as any)?.messages;
  if (!Array.isArray(messages)) return false;

  return messages.some((message: any) => {
    const content = message?.content;
    if (!Array.isArray(content)) return false;
    return content.some((part: any) => part?.type === 'image_url');
  });
}

/**
 * Reduce `messages[1].content[0].type` to `messages`, and `temperature` to
 * itself. Returns null for a null/empty param.
 */
function rootParam(param: string | null): string | null {
  if (!param) return null;
  const root = param.split(/[.[]/)[0]?.trim();
  return root && root.length > 0 ? root : null;
}
