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

export interface AiVisionProvider {
  /**
   * Read one logical extraction request.
   *
   * The service calls this once per card side so that each side yields its own
   * per-field confidence, which is what makes the front/back merge meaningful.
   */
  extractCard(
    images: VisionImage[],
    options: ExtractCardOptions,
  ): Promise<RawExtraction>;
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

export class AiProviderError extends Error {
  constructor(
    readonly kind: AiProviderErrorKind,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}
