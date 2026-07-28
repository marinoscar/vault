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
 * One image to read. A FULL, uncropped photo - the client no longer pre-crops
 * what it sends. The model locates the card and returns a `CardCropBox` per
 * image; the API does no server-side cropping.
 */
export interface VisionImage {
  side: CardSide;
  /** Full `data:image/{jpeg|png|webp};base64,...` URL. */
  dataUrl: string;
}

/**
 * Where the model found the card inside one image, exactly as that image was
 * sent. Used client-side to produce the cropped attachment the user stores.
 *
 * `x`/`y`/`width`/`height` are FRACTIONS (0-1) of the image's width/height.
 * `quarterTurns` is 0-3: the number of 90-degree CLOCKWISE rotations to apply
 * to the cropped rectangle so the card reads upright. `confidence` is 0-1.
 */
export interface CardCropBox {
  x: number;
  y: number;
  width: number;
  height: number;
  quarterTurns: number;
  confidence: number;
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
 * `cvv` IS extracted. This vault stores the card security code alongside the
 * PAN, as consumer password managers do, so a card saved here is complete
 * enough to actually use; the value is encrypted at rest like every other
 * secret field. Note the trade-off this accepts: PAN + CVV together form a
 * usable card-not-present credential, so the blast radius of a vault
 * compromise is larger than it would be with the code left out. Extracting it
 * adds no new egress - the photograph already contains the code and is already
 * sent to the provider - it only decides whether the model reads it back.
 *
 * `security_code_2` is a DIFFERENT value: an ADDITIONAL code carried by cards
 * that print more than one (for example an American Express whose primary CID
 * is on the front and which carries a second code on the back). It is never a
 * duplicate of `cvv`.
 *
 * `notes` carries auxiliary NON-SENSITIVE text printed on the card - customer
 * service phone numbers, a "Member Since" year, a website, a contactless
 * indicator, usage instructions - so real information on the card is not
 * silently dropped just because no dedicated field exists for it. It must
 * never carry the PAN or any security code.
 */
export const EXTRACTED_FIELD_NAMES = [
  'cardholder_name',
  'number',
  'exp_month',
  'exp_year',
  'cvv',
  'card_network',
  'card_kind',
  'issuing_bank',
  'security_code_2',
  'notes',
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
  /**
   * Where the model located the card in the front/back image, or null when
   * that image was not provided or no card was visible in it. Not a merge
   * field: boxes belong to one specific image, never to the combined answer.
   */
  frontBox: CardCropBox | null;
  backBox: CardCropBox | null;
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
