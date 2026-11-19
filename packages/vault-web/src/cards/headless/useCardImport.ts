import { useCallback, useEffect, useState } from 'react';

import { extractCardFromImages, getSecretTypes } from '../../core/headless/api.js';
import {
  AI_SETTINGS_PATH,
  CARD_SCAN_SUBJECT,
  describeScanError,
  scanDisabledMessage,
  scanForbiddenMessage,
  scanNotConfiguredMessage,
  type ScanErrorMessage,
} from '../../core/headless/scanErrors.js';
import { compactSecretData, useSaveSecretWithImages } from '../../core/headless/saveWithImages.js';
import {
  EXTRACTED_CARD_FIELD_NAMES,
  type AttachmentRole,
  type CardExtractionResult,
  type ExtractCardRequest,
  type SecretType,
} from '../../core/headless/types.js';
import type { CroppedCardImage, PreparedCardPhoto } from './cardImage.js';
import { CARD_TYPE_NAME } from './useCards.js';

/**
 * Confidence at or below which a field is flagged for the user to check.
 *
 * A flag costs one glance; a wrong digit that ships silently costs a declined
 * payment, so this is set generously rather than tightly.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.7;

/**
 * A captured photo of one card side: the raw file, the prepared full-frame
 * data URL that goes to the extraction endpoint, and a preview object URL.
 * The page that creates it owns (and must revoke) the preview URL.
 */
export interface CapturedCardPhoto {
  file: File;
  prepared: PreparedCardPhoto;
  previewUrl: string;
}

/** A captured card side, cropped to the card and ready to upload/attach. */
export interface CapturedCardSide {
  role: AttachmentRole;
  image: CroppedCardImage;
}

/**
 * A failure rendered for a human: the shared scan message
 * ({@link ScanErrorMessage}), under its card-era name.
 */
export type CardExtractionMessage = ScanErrorMessage;

export { AI_SETTINGS_PATH };

/** AI switched off by an administrator (the platform kill switch's 403). */
export const AI_DISABLED_MESSAGE: CardExtractionMessage = scanDisabledMessage(CARD_SCAN_SUBJECT);

/** AI on, but the provider, model or key is not set up (503 `AI_NOT_CONFIGURED`). */
export const AI_NOT_CONFIGURED_MESSAGE: CardExtractionMessage = scanNotConfiguredMessage(CARD_SCAN_SUBJECT);

/** The caller may not use AI (a `403` without `AI_DISABLED`: no `ai:use`). */
export const AI_FORBIDDEN_MESSAGE: CardExtractionMessage = scanForbiddenMessage(CARD_SCAN_SUBJECT);

/**
 * Map a card extraction failure to an actionable message: the shared
 * {@link describeScanError} worded for a card.
 */
export function describeCardExtractionError(error: unknown): CardExtractionMessage {
  return describeScanError(error, CARD_SCAN_SUBJECT);
}

/**
 * Fields that are typed by hand and NEVER seeded from an extraction: the card
 * security codes (E10.5, issue #96; AGENTS.md AI rule 3). Since E8.1 the API
 * always answers them `null` (confidence 0); the review form starts them empty
 * whatever arrives, so the code a user saves is always the one they typed.
 */
export const MANUAL_ONLY_CARD_FIELDS: ReadonlySet<string> = new Set(['cvv', 'security_code_2']);

/**
 * Seed the review form from an extraction.
 *
 * Every value becomes a string because the form edits strings. The security
 * codes ({@link MANUAL_ONLY_CARD_FIELDS}) are never seeded: they always start
 * empty, whatever the extraction returned, and the user types them.
 */
export function toReviewValues(
  extraction: CardExtractionResult | null,
): Record<string, string> {
  const values: Record<string, string> = { cvv: '' };
  for (const name of EXTRACTED_CARD_FIELD_NAMES) {
    values[name] = MANUAL_ONLY_CARD_FIELDS.has(name) ? '' : (extraction?.fields?.[name] ?? '');
  }
  return values;
}

/**
 * The fields whose seeded value came from the extraction (non-empty and not
 * manual-only), so the review form can mark them "read by AI".
 */
export function aiSeededFields(extraction: CardExtractionResult | null): Set<string> {
  const seeded = new Set<string>();
  if (!extraction?.fields) return seeded;
  for (const name of EXTRACTED_CARD_FIELD_NAMES) {
    if (MANUAL_ONLY_CARD_FIELDS.has(name)) continue;
    const value = extraction.fields[name];
    if (typeof value === 'string' && value.trim() !== '') seeded.add(name);
  }
  return seeded;
}

/**
 * Default name for the imported secret, e.g. `Visa ••••4242`.
 *
 * Only the last four digits appear: a secret's name is metadata that shows up
 * in lists, search results and audit records, none of which should carry a PAN.
 */
export function buildDefaultCardName(
  network: string | null | undefined,
  number: string | null | undefined,
): string {
  const digits = (number ?? '').replace(/\D/g, '');
  const label = (network ?? '').trim() || 'Card';
  if (digits.length < 4) return label === 'Card' ? 'Imported card' : label;
  return `${label} ••••${digits.slice(-4)}`;
}

export interface SaveCardInput {
  name: string;
  values: Record<string, string>;
  images: CapturedCardSide[];
}

export interface SaveCardOutcome {
  secretId: string;
  /**
   * Set when the card itself saved but one or more images could not be
   * attached. The secret is kept — losing hand-typed card details over a failed
   * image upload would be a worse outcome — and the orphaned uploads are
   * deleted.
   */
  attachmentWarning: string | null;
}

interface UseCardImportResult {
  cardType: SecretType | null;
  isTypeLoading: boolean;
  typeError: string | null;

  extraction: CardExtractionResult | null;
  extractionError: CardExtractionMessage | null;
  isExtracting: boolean;
  /**
   * Run the extraction on the prepared FULL photos. NEVER REJECTS — a failure
   * resolves to `null` and lands in `extractionError`, so the caller always
   * advances to review.
   */
  runExtraction: (
    photos: ExtractCardRequest,
  ) => Promise<CardExtractionResult | null>;

  isSaving: boolean;
  saveError: string | null;
  saveCard: (input: SaveCardInput) => Promise<SaveCardOutcome | null>;

  /** Delete anything this flow created. Safe to call repeatedly. */
  abandonImport: () => Promise<void>;
}

/**
 * Network and cleanup side of the card import wizard.
 *
 * The page owns the step, the captured images and the form values; this hook
 * owns everything that touches the server and, crucially, everything that has
 * to be undone if the user walks away.
 */
export function useCardImport(): UseCardImportResult {
  const [cardType, setCardType] = useState<SecretType | null>(null);
  const [isTypeLoading, setIsTypeLoading] = useState(true);
  const [typeError, setTypeError] = useState<string | null>(null);

  const [extraction, setExtraction] = useState<CardExtractionResult | null>(null);
  const [extractionError, setExtractionError] =
    useState<CardExtractionMessage | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // The secret, the uploads and their cleanup (on failure and on unmount).
  const { saveSecretWithImages, cleanup } = useSaveSecretWithImages();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setIsTypeLoading(true);
      setTypeError(null);
      try {
        // There is no category column on SecretType, so the Card type is
        // identified by the name of the system type — same rule as useCards.
        const types = await getSecretTypes({ includeSystem: true });
        if (cancelled) return;
        const found =
          types.find((type) => type.isSystem && type.name === CARD_TYPE_NAME) ?? null;
        setCardType(found);
        if (!found) {
          setTypeError(
            'The Card secret type is missing, so cards cannot be imported.',
          );
        }
      } catch (err) {
        if (cancelled) return;
        setTypeError(
          err instanceof Error ? err.message : 'Failed to load the Card secret type',
        );
      } finally {
        if (!cancelled) setIsTypeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runExtraction = useCallback(
    async (photos: ExtractCardRequest): Promise<CardExtractionResult | null> => {
      setIsExtracting(true);
      setExtractionError(null);
      setExtraction(null);
      try {
        const result = await extractCardFromImages(photos);
        setExtraction(result);
        return result;
      } catch (err) {
        // Deliberately does not rethrow. A failed read is not a dead end: the
        // caller moves the user on to the review step with an empty form and
        // the photos they already took, so the card can be typed by hand.
        setExtractionError(describeCardExtractionError(err));
        return null;
      } finally {
        setIsExtracting(false);
      }
    },
    [],
  );

  const saveCard = useCallback(
    async ({ name, values, images }: SaveCardInput): Promise<SaveCardOutcome | null> => {
      setIsSaving(true);
      setSaveError(null);

      try {
        if (!cardType) {
          throw new Error('The Card secret type is unavailable.');
        }

        const { secretId, failedRoles } = await saveSecretWithImages({
          name,
          typeId: cardType.id,
          // Empty strings are dropped rather than stored.
          data: compactSecretData(values),
          images: images.map((side) => ({ role: side.role, file: side.image.file })),
        });
        const failedSides = failedRoles.map((role) => (role === 'card_front' ? 'front' : 'back'));

        return {
          secretId,
          attachmentWarning:
            failedSides.length > 0
              ? `The card was saved, but the ${failedSides.join(' and ')} photo could not be attached.`
              : null,
        };
      } catch (err) {
        // The secret itself failed; the saver has already removed what it made.
        setSaveError(err instanceof Error ? err.message : 'Failed to save the card');
        return null;
      } finally {
        setIsSaving(false);
      }
    },
    [cardType, saveSecretWithImages],
  );

  const abandonImport = useCallback(async () => {
    await cleanup();
  }, [cleanup]);

  return {
    cardType,
    isTypeLoading,
    typeError,
    extraction,
    extractionError,
    isExtracting,
    runExtraction,
    isSaving,
    saveError,
    saveCard,
    abandonImport,
  };
}
