import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createSecret,
  deleteSecret,
  deleteStorageObject,
  extractCardFromImages,
  getSecretTypes,
  linkSecretAttachment,
  simpleStorageUpload,
} from '../services/api';
import { ApiError } from '../services/api';
import {
  AI_ERROR_CODES,
  EXTRACTED_CARD_FIELD_NAMES,
  type AiErrorCode,
  type AttachmentRole,
  type CardExtractionResult,
  type ExtractCardRequest,
  type SecretType,
} from '../types';
import type { CroppedCardImage, PreparedCardPhoto } from '../utils/cardImage';
import { CARD_TYPE_NAME } from './useCards';

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
 * A failure rendered for a human.
 *
 * `detail` is written to tell the user what to do next, which is why the
 * per-code branches exist at all — "Too many requests" is true for both the
 * burst limiter and the daily budget, and useless for either.
 */
export interface CardExtractionMessage {
  title: string;
  detail: string;
  /** True when only an administrator can clear the condition. */
  adminActionRequired: boolean;
  /** True when retrying the same images could plausibly succeed. */
  retryable: boolean;
}

const AI_ERROR_CODE_VALUES: readonly string[] = Object.values(AI_ERROR_CODES);

function isAiErrorCode(code: string | undefined): code is AiErrorCode {
  return code !== undefined && AI_ERROR_CODE_VALUES.includes(code);
}

/**
 * Map an extraction failure to an actionable message.
 *
 * Branches on the API's `code` first, then falls back to the HTTP status.
 *
 * KNOWN ISSUE #35: the API's global `HttpExceptionFilter` ends with an
 * unconditional `code = this.getCodeFromStatus(status)`, which throws away the
 * `AI_*` code every `AiException` carries. So today every 429 arrives as
 * `TOO_MANY_REQUESTS` and the burst limit is indistinguishable from the daily
 * quota — hence the deliberately two-sided 429 fallback below. The `code`
 * branches are already correct and start firing, with no change to this
 * function, the moment #35 is fixed.
 *
 * Codes are matched against the known `AI_*` set rather than trusted blindly,
 * so the filter's status-derived stand-ins ('TOO_MANY_REQUESTS', 'BAD_REQUEST')
 * fall through to the status branch instead of matching nothing and producing a
 * generic message. Message text is never parsed: it is copy, it will be
 * reworded, and branching on it would break silently when it is.
 */
export function describeCardExtractionError(error: unknown): CardExtractionMessage {
  const apiError = error instanceof ApiError ? error : null;
  const code = isAiErrorCode(apiError?.code) ? apiError.code : undefined;
  const status = apiError?.status;

  switch (code) {
    case AI_ERROR_CODES.NOT_CONFIGURED:
      return {
        title: 'Card scanning is not set up',
        detail:
          'An administrator needs to enable AI and store an OpenAI API key in System Settings before cards can be scanned.',
        adminActionRequired: true,
        retryable: false,
      };
    case AI_ERROR_CODES.KEY_UNREADABLE:
      return {
        title: 'Card scanning is unavailable',
        detail:
          'The stored OpenAI API key could not be read. An administrator needs to re-enter it in System Settings.',
        adminActionRequired: true,
        retryable: false,
      };
    case AI_ERROR_CODES.INVALID_IMAGE:
      return {
        title: 'Those photos could not be sent',
        detail:
          'The images were not accepted. Retake the photos and try again.',
        adminActionRequired: false,
        retryable: true,
      };
    case AI_ERROR_CODES.RATE_LIMITED:
      return {
        title: 'Too many scans just now',
        detail:
          'You have scanned several cards in a short period. Wait a moment and try again shortly.',
        adminActionRequired: false,
        retryable: true,
      };
    case AI_ERROR_CODES.QUOTA_EXCEEDED:
      return {
        title: 'Daily scan limit reached',
        detail:
          'You have used your daily card scan allowance. Try again tomorrow, or ask an administrator to raise the limit.',
        adminActionRequired: false,
        retryable: false,
      };
    case AI_ERROR_CODES.UPSTREAM_AUTH:
      return {
        title: 'Card scanning is unavailable',
        detail:
          'The AI provider rejected the configured API key. An administrator needs to check it in System Settings.',
        adminActionRequired: true,
        retryable: false,
      };
    case AI_ERROR_CODES.UPSTREAM_RATE_LIMITED:
      return {
        title: 'The AI provider is busy',
        detail: 'The provider is rate limiting requests. Try again shortly.',
        adminActionRequired: false,
        retryable: true,
      };
    case AI_ERROR_CODES.UPSTREAM_UNAVAILABLE:
      return {
        title: 'The AI provider is unavailable',
        detail:
          'The provider could not be reached. Try again shortly, or enter the card details yourself.',
        adminActionRequired: false,
        retryable: true,
      };
    case AI_ERROR_CODES.EXTRACTION_FAILED:
      return {
        title: 'The card could not be read',
        detail:
          'Try again with a sharper, better-lit photo, or enter the details yourself below.',
        adminActionRequired: false,
        retryable: true,
      };
    default:
      break;
  }

  switch (status) {
    case 400:
      return {
        title: 'Those photos could not be sent',
        detail: 'The images were not accepted. Retake the photos and try again.',
        adminActionRequired: false,
        retryable: true,
      };
    case 422:
      return {
        title: 'The card could not be read',
        detail:
          'Try again with a sharper, better-lit photo, or enter the details yourself below.',
        adminActionRequired: false,
        retryable: true,
      };
    case 429:
      // Ambiguous only because of #35 — burst limit and daily quota share this
      // status. The wording covers both without claiming either.
      return {
        title: 'Scan limit reached',
        detail:
          'You have hit a card scan limit — either too many scans in a short period, or your daily allowance. Wait a few minutes and try again; if it persists you are out of scans for today.',
        adminActionRequired: false,
        retryable: true,
      };
    case 502:
      return {
        title: 'The AI provider is unavailable',
        detail:
          'The provider could not be reached, or rejected the configured API key. Try again shortly, or enter the card details yourself.',
        adminActionRequired: false,
        retryable: true,
      };
    case 503:
      return {
        title: 'Card scanning is not set up',
        detail:
          'An administrator needs to enable AI and store an OpenAI API key in System Settings before cards can be scanned.',
        adminActionRequired: true,
        retryable: false,
      };
    default:
      return {
        title: 'The card could not be read',
        detail:
          error instanceof Error && error.message
            ? error.message
            : 'Something went wrong reading the card. Enter the details yourself below.',
        adminActionRequired: false,
        retryable: true,
      };
  }
}

/**
 * Seed the review form from an extraction.
 *
 * Every value becomes a string because the form edits strings. `cvv` seeds from
 * the extraction like every other field; the empty default below only covers
 * the case where the model returned nothing for it, so the input still renders
 * and the user can type the code from the card.
 */
export function toReviewValues(
  extraction: CardExtractionResult | null,
): Record<string, string> {
  const values: Record<string, string> = { cvv: '' };
  for (const name of EXTRACTED_CARD_FIELD_NAMES) {
    values[name] = extraction?.fields?.[name] ?? '';
  }
  return values;
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

  // Everything this flow has created but not yet committed. Held in refs, not
  // state, because the unmount cleanup below has to see the CURRENT values —
  // a stale closure over state would leak exactly the objects it exists to
  // delete.
  const orphanObjectIdsRef = useRef<Set<string>>(new Set());
  const uncommittedSecretIdRef = useRef<string | null>(null);

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

  /**
   * Best effort, never throws. Cleanup runs on paths that are already failing
   * or already unmounting; a rejection here would replace a useful error with a
   * useless one, or reject inside an effect teardown.
   */
  const cleanup = useCallback(async () => {
    const objectIds = [...orphanObjectIdsRef.current];
    orphanObjectIdsRef.current.clear();
    const secretId = uncommittedSecretIdRef.current;
    uncommittedSecretIdRef.current = null;

    await Promise.allSettled([
      ...objectIds.map((id) => deleteStorageObject(id)),
      // Deleting the secret also deletes the storage objects behind its linked
      // attachments, so linked ids are removed from the orphan set as they are
      // linked and are not double-deleted here.
      ...(secretId ? [deleteSecret(secretId)] : []),
    ]);
  }, []);

  // Walking away — back button, browser navigation, closing the wizard — must
  // not leave an image sitting in storage that nothing points at.
  useEffect(() => {
    return () => {
      void cleanup();
    };
  }, [cleanup]);

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

        // Empty strings are dropped rather than stored: a blank optional field
        // should be absent, not an empty value the detail view renders as ''.
        const data: Record<string, string> = {};
        for (const [key, value] of Object.entries(values)) {
          const trimmed = value.trim();
          if (trimmed !== '') data[key] = trimmed;
        }

        const secret = await createSecret({
          name: name.trim(),
          typeId: cardType.id,
          data,
        });
        uncommittedSecretIdRef.current = secret.id;

        const failedSides: string[] = [];
        for (const side of images) {
          try {
            const object = await simpleStorageUpload(side.image.file);
            orphanObjectIdsRef.current.add(object.id);
            await linkSecretAttachment(
              secret.id,
              object.id,
              side.image.file.name,
              side.role,
            );
            // Now owned by the secret: deleting the secret would delete it too,
            // so it is no longer an orphan and must not be deleted twice.
            orphanObjectIdsRef.current.delete(object.id);
          } catch {
            failedSides.push(side.role === 'card_front' ? 'front' : 'back');
          }
        }

        // Committed. Clearing these is what stops the unmount cleanup from
        // deleting the secret the user just saved.
        uncommittedSecretIdRef.current = null;
        const orphans = [...orphanObjectIdsRef.current];
        orphanObjectIdsRef.current.clear();
        await Promise.allSettled(orphans.map((id) => deleteStorageObject(id)));

        return {
          secretId: secret.id,
          attachmentWarning:
            failedSides.length > 0
              ? `The card was saved, but the ${failedSides.join(' and ')} photo could not be attached.`
              : null,
        };
      } catch (err) {
        // The secret itself failed, so nothing of value exists to keep.
        await cleanup();
        setSaveError(err instanceof Error ? err.message : 'Failed to save the card');
        return null;
      } finally {
        setIsSaving(false);
      }
    },
    [cardType, cleanup],
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
