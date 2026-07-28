// =============================================================================
// AI Vision Provider Abstraction
// =============================================================================
// Mirrors the STORAGE_PROVIDER idiom in src/storage/providers: a Symbol token
// plus an interface, bound with `useClass` in the owning module so tests can
// swap the implementation without touching the network.

/**
 * Dependency injection token for the vision provider.
 */
export const AI_VISION_PROVIDER = Symbol('AI_VISION_PROVIDER');

export type CardSide = 'front' | 'back';

/**
 * One image to read. Already cropped to the card by the client - the API does
 * no server-side cropping and returns no crop box.
 */
export interface VisionImage {
  side: CardSide;
  /** Full `data:image/{jpeg|png|webp};base64,...` URL. */
  dataUrl: string;
}

export interface ExtractCardOptions {
  /** Plaintext provider credential. Never logged, never persisted. */
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

/**
 * Field names requested from the model.
 *
 * `cvv` is deliberately absent and must never be added: the CVV/CVC is the one
 * value that turns a photographed card number into a usable card-not-present
 * credential, so it is never sent to a third party and never returned.
 * `security_code_2` is a DIFFERENT value - the CID / control number printed on
 * the card face (e.g. the 4 digits on an American Express front).
 */
export const EXTRACTED_FIELD_NAMES = [
  'cardholder_name',
  'number',
  'exp_month',
  'exp_year',
  'card_network',
  'card_kind',
  'issuing_bank',
  'security_code_2',
] as const;

export type ExtractedFieldName = (typeof EXTRACTED_FIELD_NAMES)[number];

export type RawCardFields = Record<ExtractedFieldName, string | null>;
export type RawCardConfidence = Record<ExtractedFieldName, number>;

/**
 * Exactly what the model returned, after schema re-validation but before any
 * server-side normalization.
 */
export interface RawExtraction {
  fields: RawCardFields;
  confidence: RawCardConfidence;
  warnings: string[];
  model: string;
}

/**
 * Outcome of a successful capability probe.
 *
 * There is no `imageSupport: false` variant: a probe either completes - which
 * proves the key, the model name, image input and structured outputs all work,
 * because the single request needed all four - or it throws an
 * `AiProviderError` carrying the reason. A boolean-per-capability result would
 * imply the capabilities can be checked independently, and they cannot: OpenAI
 * exposes no capability metadata, so the only evidence available is whether one
 * real request succeeded.
 */
export interface VerifyModelResult {
  /** Model as reported by the provider, falling back to the one requested. */
  model: string;
  /**
   * Parameters the adaptive retry had to remove for the call to succeed.
   * Empty on a model that accepted the request as sent.
   */
  droppedParameters: string[];
}

export interface AiVisionProvider {
  /**
   * Read one logical extraction request.
   *
   * The service passes EVERY side of the card in a single call, so the model
   * can cross-reference the images - modern cards often print the number and
   * expiry on the back - and answer once for the whole card.
   */
  extractCard(
    images: VisionImage[],
    options: ExtractCardOptions,
  ): Promise<RawExtraction>;

  /**
   * Prove that the configured credential and model can actually do the job.
   *
   * Must be an EMPIRICAL probe - a real, minimal, billable request - not a
   * lookup against a capability table or a model list. Implementations must not
   * branch on model names or version numbers.
   *
   * @throws AiProviderError with `detail` set when the cause is specific.
   */
  verifyModel(options: ExtractCardOptions): Promise<VerifyModelResult>;
}

// -----------------------------------------------------------------------------
// Provider-level failures
// -----------------------------------------------------------------------------

/**
 * Transport/protocol classification produced by a provider. The service maps
 * these to HTTP status codes; providers never throw HttpException themselves,
 * so an upstream 401 can never leak out as a client-facing 401.
 */
export type AiProviderErrorKind =
  /** Upstream rejected our credential (401/403). */
  | 'auth'
  /** Upstream rate limited us (429). */
  | 'rate_limited'
  /** Upstream 5xx, network error, or timeout. */
  | 'unavailable'
  /** Response was not parseable / did not match the schema, or model refused. */
  | 'invalid_output';

/**
 * Optional refinement of `AiProviderErrorKind`.
 *
 * Deliberately an EXTENSION of the existing taxonomy rather than a parallel one:
 * `kind` still drives the HTTP mapping in CardExtractService exactly as before,
 * and `detail` only adds the extra precision the verify endpoint needs to tell
 * an admin which setting to fix. Callers that do not care may ignore it.
 */
export type AiProviderErrorDetail =
  /** The model name does not resolve for this credential. */
  | 'model_not_found'
  /** The model resolved but refused image content. */
  | 'model_no_image_support'
  /** The model resolved but refused `response_format: json_schema`. */
  | 'model_no_structured_output'
  /** The account is out of credit; waiting will not help. */
  | 'quota';

export class AiProviderError extends Error {
  constructor(
    readonly kind: AiProviderErrorKind,
    message: string,
    readonly retryAfterSeconds?: number,
    readonly detail?: AiProviderErrorDetail,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}
