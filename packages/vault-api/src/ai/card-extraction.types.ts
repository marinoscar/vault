// =============================================================================
// Card extraction types (issue #87, E8.1)
// =============================================================================
// What was `providers/vision-provider.interface.ts`. The provider abstraction is
// gone (the platform AI slice owns provider calls); these are the shapes the
// normalizer and the service pass around.

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

/**
 * Field names of the extraction result.
 *
 * `cvv` and `security_code_2` stay in the SHAPE so the review form's wire
 * contract does not change, but they are NEVER requested from the model and are
 * always null / confidence 0 in the response (issue #87, E8.1): the normalizer
 * drops anything a model returns under those names.
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

