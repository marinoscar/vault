import { useCallback, useEffect, useRef, useState } from 'react';

import {
  deleteStorageObject,
  extractCardFromImages,
  getSecret,
  renewSecret,
  simpleStorageUpload,
} from '../services/api';
import {
  EXTRACTED_CARD_FIELD_NAMES,
  type CardExtractionResult,
  type FieldDefinition,
  type RenewSecretAttachment,
  type SecretDetail,
} from '../types';
import {
  describeCardExtractionError,
  type CapturedCardSide,
  type CardExtractionMessage,
} from './useCardImport';

/**
 * The one field a renewal must never carry forward.
 *
 * Every other value is seeded from the outgoing card, because most of a
 * reissued card is unchanged. The security code is not: a reissued card always
 * carries a new one, and pre-filling the old one would produce a card record
 * that looks complete and declines at the till. It is also the value the
 * extraction deliberately never returns, so there is nothing to seed it from
 * either. It is collected by hand, exactly as in the import wizard.
 */
export const CVV_FIELD = 'cvv';

/**
 * The one field a renewal APPENDS to rather than replaces.
 *
 * Existing notes are the user's own words (or a previous card's auxiliary
 * text) and must not be silently overwritten by whatever the new photo
 * happens to say — the freshly read text goes on a new line below instead.
 */
const NOTES_FIELD = 'notes';

/** Read a stored value as a trimmed display string; never throws. */
function toDisplayString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/**
 * Flatten a secret's decrypted values into the string map the review form edits.
 *
 * Keyed by the TYPE's fields rather than by the stored object, because the API
 * rejects an unknown field name outright (`Unknown field "x"` -> 400). A value
 * left behind by a since-removed field would otherwise ride along in `data` and
 * fail the whole renewal, so those are dropped here.
 */
export function toCurrentValues(
  fields: FieldDefinition[],
  values: Record<string, unknown> | undefined,
): Record<string, string> {
  const current: Record<string, string> = {};
  for (const field of fields) {
    current[field.name] = toDisplayString(values?.[field.name]);
  }
  return current;
}

/**
 * Seed the renewal form: the extraction where it produced something, the
 * outgoing card everywhere else.
 *
 * This is what makes an unchanged field submit its current value. A renewal
 * sends a full `data` object and the API replaces rather than merges, so a
 * field the user never touches has to arrive carrying the old card's value or
 * it is dropped from the new version.
 *
 * A `null` from the extraction means "could not read it", NOT "the card no
 * longer has one", so it falls back to the current value rather than blanking
 * the field. `cvv` is always empty — see {@link CVV_FIELD}.
 */
export function toRenewalValues(
  currentValues: Record<string, string>,
  extraction: CardExtractionResult | null,
): Record<string, string> {
  const proposed: Record<string, string> = { ...currentValues };

  for (const name of EXTRACTED_CARD_FIELD_NAMES) {
    // Only fields the type actually declares are in `currentValues`; the
    // extraction may return more than this card's type knows about.
    if (!(name in proposed)) continue;
    const extracted = extraction?.fields?.[name];
    if (typeof extracted !== 'string' || extracted.trim() === '') continue;
    const trimmed = extracted.trim();

    if (name === NOTES_FIELD && proposed[name].trim() !== '') {
      // Append, never overwrite — see NOTES_FIELD. Skipped when the existing
      // notes already contain the text verbatim, so renewing the same card
      // twice does not stack duplicates.
      if (!proposed[name].includes(trimmed)) {
        proposed[name] = `${proposed[name]}\n${trimmed}`;
      }
    } else {
      proposed[name] = trimmed;
    }
  }

  if (CVV_FIELD in proposed) proposed[CVV_FIELD] = '';
  return proposed;
}

/** One field's before/after, as rendered by the diff step. */
export interface CardFieldChange {
  field: FieldDefinition;
  current: string;
  proposed: string;
  changed: boolean;
}

/**
 * Compare the outgoing card against what is about to be saved.
 *
 * `cvv` is reported as changed whenever something has been typed, since there
 * is no current value to compare against — the old code is never shown and
 * never reused.
 */
export function diffCardFields(
  fields: FieldDefinition[],
  currentValues: Record<string, string>,
  proposedValues: Record<string, string>,
): CardFieldChange[] {
  return fields.map((field) => {
    const current = (currentValues[field.name] ?? '').trim();
    const proposed = (proposedValues[field.name] ?? '').trim();
    return {
      field,
      current,
      proposed,
      changed:
        field.name === CVV_FIELD ? proposed !== '' : proposed !== current,
    };
  });
}

/**
 * Whether the values being submitted actually came off a photo.
 *
 * Deliberately checks the OUTGOING payload rather than "did an extraction
 * happen": a user who read the card with AI and then corrected every field by
 * hand submitted hand-typed values, and the audit trail should say so. One
 * surviving extracted value is enough to make the renewal AI-assisted.
 */
export function wasAiAssisted(
  extraction: CardExtractionResult | null,
  data: Record<string, string>,
): boolean {
  if (!extraction) return false;
  return EXTRACTED_CARD_FIELD_NAMES.some((name) => {
    const extracted = extraction.fields?.[name];
    if (typeof extracted !== 'string' || extracted.trim() === '') return false;
    return data[name] === extracted.trim();
  });
}

export interface SubmitRenewalInput {
  values: Record<string, string>;
  /** New photos. A side that is absent is carried forward from the old version. */
  images: CapturedCardSide[];
  extraction: CardExtractionResult | null;
}

interface UseCardRenewalResult {
  secret: SecretDetail | null;
  fields: FieldDefinition[];
  currentValues: Record<string, string>;
  isLoading: boolean;
  loadError: string | null;

  extraction: CardExtractionResult | null;
  extractionError: CardExtractionMessage | null;
  isExtracting: boolean;
  /** Never rejects: a failure resolves to `null` and lands in `extractionError`. */
  runExtraction: (
    images: CapturedCardSide[],
  ) => Promise<CardExtractionResult | null>;

  isSubmitting: boolean;
  submitError: string | null;
  /** Resolves to the renewed secret, or `null` when nothing was created. */
  submitRenewal: (input: SubmitRenewalInput) => Promise<SecretDetail | null>;

  /** Delete anything this flow uploaded. Safe to call repeatedly. */
  abandonRenewal: () => Promise<void>;
}

/**
 * Network and cleanup side of the card renewal wizard.
 *
 * Renewal differs from import in the shape of its failure modes, and the
 * difference drives the design here. Import creates a secret and then links
 * files to it, so a half-done save leaves a real secret worth keeping. Renewal
 * commits through ONE atomic endpoint, so there is no partial version to
 * rescue: either every uploaded image is in hand before the call, or nothing is
 * created at all. Uploads are therefore done up front and rolled back on any
 * failure, rather than tolerated individually the way the import wizard
 * tolerates a failed attachment link.
 */
export function useCardRenewal(secretId: string | undefined): UseCardRenewalResult {
  const [secret, setSecret] = useState<SecretDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [extraction, setExtraction] = useState<CardExtractionResult | null>(null);
  const [extractionError, setExtractionError] =
    useState<CardExtractionMessage | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Storage objects uploaded by this flow that nothing points at yet. Held in a
  // ref, not state, so the unmount cleanup below sees the CURRENT set — a stale
  // closure over state would leak exactly the objects it exists to delete.
  const orphanObjectIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!secretId) {
      setIsLoading(false);
      setLoadError('No card was specified.');
      return;
    }

    let cancelled = false;
    void (async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        // The detail response carries both the decrypted values and the secret
        // type's field definitions, so the whole form can be built from one
        // request — no separate secret-types lookup as in the import wizard.
        const detail = await getSecret(secretId);
        if (cancelled) return;
        setSecret(detail);
      } catch (err) {
        if (cancelled) return;
        setLoadError(
          err instanceof Error ? err.message : 'Failed to load the card',
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [secretId]);

  /**
   * Best effort, never throws. Cleanup runs on paths that are already failing
   * or already unmounting; a rejection here would replace a useful error with a
   * useless one, or reject inside an effect teardown.
   */
  const cleanup = useCallback(async () => {
    const objectIds = [...orphanObjectIdsRef.current];
    orphanObjectIdsRef.current.clear();
    await Promise.allSettled(objectIds.map((id) => deleteStorageObject(id)));
  }, []);

  // Walking away must not leave an image sitting in storage that nothing points
  // at. Renewal never creates a secret, so uploads are the only debris possible.
  useEffect(() => {
    return () => {
      void cleanup();
    };
  }, [cleanup]);

  const runExtraction = useCallback(
    async (images: CapturedCardSide[]): Promise<CardExtractionResult | null> => {
      setIsExtracting(true);
      setExtractionError(null);
      setExtraction(null);
      try {
        const front = images.find((side) => side.role === 'card_front');
        if (!front) {
          throw new Error('A photo of the front of the card is required.');
        }
        const back = images.find((side) => side.role === 'card_back');

        const result = await extractCardFromImages({
          front: front.image.dataUrl,
          back: back?.image.dataUrl,
        });
        setExtraction(result);
        return result;
      } catch (err) {
        // Deliberately does not rethrow, and shares the import wizard's mapper
        // rather than restating it: a failed read is not a dead end, the caller
        // moves the user on to the diff step with the old card's values still
        // in the form.
        setExtractionError(describeCardExtractionError(err));
        return null;
      } finally {
        setIsExtracting(false);
      }
    },
    [],
  );

  const submitRenewal = useCallback(
    async ({
      values,
      images,
      extraction: usedExtraction,
    }: SubmitRenewalInput): Promise<SecretDetail | null> => {
      if (!secretId || !secret) {
        setSubmitError('The card is not loaded yet.');
        return null;
      }

      setIsSubmitting(true);
      setSubmitError(null);

      try {
        // Only fields the type declares, and only non-empty ones. An unknown
        // key is a 400 from the API, and an empty optional field should be
        // absent rather than stored as ''.
        const data: Record<string, string> = {};
        for (const field of secret.type.fields) {
          const trimmed = (values[field.name] ?? '').trim();
          if (trimmed !== '') data[field.name] = trimmed;
        }

        // Upload everything BEFORE renewing. The renew call is atomic, so a
        // failure here must leave no new version at all; uploading first means
        // the only thing to undo is storage objects nothing references yet.
        const attachments: RenewSecretAttachment[] = [];
        for (const side of images) {
          const object = await simpleStorageUpload(side.image.file);
          orphanObjectIdsRef.current.add(object.id);
          attachments.push({
            storageObjectId: object.id,
            role: side.role,
            label: side.image.file.name,
          });
        }

        const renewed = await renewSecret(secretId, {
          data,
          // Omitted entirely when empty: an empty array on a type that does not
          // allow attachments is still a 400, and a manual renewal with no new
          // photos has nothing to say here.
          ...(attachments.length > 0 ? { attachments } : {}),
          aiAssisted: wasAiAssisted(usedExtraction, data),
        });

        // Committed: the new version owns these now, so they are no longer
        // orphans and must not be deleted on unmount.
        orphanObjectIdsRef.current.clear();
        return renewed;
      } catch (err) {
        // Nothing partial survives a renewal failure — drop the uploads.
        await cleanup();
        setSubmitError(
          err instanceof Error ? err.message : 'Failed to renew the card',
        );
        return null;
      } finally {
        setIsSubmitting(false);
      }
    },
    [cleanup, secret, secretId],
  );

  const abandonRenewal = useCallback(async () => {
    await cleanup();
  }, [cleanup]);

  const fields = secret?.type?.fields ?? [];

  return {
    secret,
    fields,
    currentValues: toCurrentValues(fields, secret?.values),
    isLoading,
    loadError,
    extraction,
    extractionError,
    isExtracting,
    runExtraction,
    isSubmitting,
    submitError,
    submitRenewal,
    abandonRenewal,
  };
}
