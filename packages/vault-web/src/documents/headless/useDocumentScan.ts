import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DOCUMENT_IMAGE_SLOTS,
  type DocumentImageSlot,
  type DocumentScanSlot,
  type ExtractDocumentResponse,
  type ScannableDocumentType,
} from '@marinoscar/vault-contract/secrets';

import { extractDocument } from '../../core/headless/api.js';
import { readDriverLicenseBarcode } from './barcode.js';
import {
  DOCUMENT_SCAN_SUBJECT,
  describeScanError,
  type ScanErrorMessage,
} from '../../core/headless/scanErrors.js';
import { useSaveSecretWithImages } from '../../core/headless/saveWithImages.js';
import type { AttachmentRole, KeyValueEntry, SecretType } from '../../core/headless/types.js';
import type { CroppedCardImage, PreparedCardPhoto } from '../../cards/headless/cardImage.js';
import { findCountry } from '../../secrets/headless/country.js';
import { useSecretTypes } from '../../secrets/headless/useSecretTypes.js';
import {
  ID_DOCUMENT_TYPE_NAME,
  PASSPORT_TYPE_NAME,
  cleanSecretData,
} from '../../secrets/headless/secretFields.js';

export type { ScannableDocumentType };

/**
 * Confidence at or below which a value read from the photos is flagged for the
 * user to check (the card scan's threshold).
 */
export const DOCUMENT_LOW_CONFIDENCE_THRESHOLD = 0.7;

/** The system secret type each scannable document type saves as. */
export const DOCUMENT_SCAN_TYPE_NAMES: Readonly<Record<ScannableDocumentType, string>> = {
  passport: PASSPORT_TYPE_NAME,
  id_document: ID_DOCUMENT_TYPE_NAME,
};

/** `passport` or `id_document` from a `?type=` value; `id_document` otherwise. */
export function parseDocumentScanType(value: string | null | undefined): ScannableDocumentType {
  return value === 'passport' ? 'passport' : 'id_document';
}

/** The image slots captured for a document type, in capture order (required first). */
export function documentScanSlots(documentType: ScannableDocumentType): readonly DocumentImageSlot[] {
  return DOCUMENT_IMAGE_SLOTS[DOCUMENT_SCAN_TYPE_NAMES[documentType]] ?? [];
}

/**
 * A captured photo of one slot: the raw file, the prepared full frame sent to
 * the extraction endpoint, and a preview object URL the page owns (and revokes).
 */
export interface CapturedDocumentPhoto {
  file: File;
  prepared: PreparedCardPhoto;
  previewUrl: string;
}

/** A cropped slot image ready to upload and attach under its role. */
export interface CapturedDocumentImage {
  role: AttachmentRole;
  image: CroppedCardImage;
}

/**
 * The review form's starting point, seeded from an extraction: `values` holds
 * the typed fields (strings), `document_kind` and `attributes` (key/value
 * entries); `attributeConfidence` keeps each read attribute's confidence by key
 * for the review's "Check" outline.
 */
export interface DocumentReviewSeed {
  values: Record<string, unknown>;
  attributeConfidence: Record<string, number>;
}

/** Seed the review form from an extraction (`null`: an empty form). */
export function toDocumentReviewValues(result: ExtractDocumentResponse | null): DocumentReviewSeed {
  const values: Record<string, unknown> = {};
  const attributeConfidence: Record<string, number> = {};
  if (!result) return { values, attributeConfidence };

  for (const [name, value] of Object.entries(result.fields)) {
    if (typeof value === 'string' && value.trim() !== '') values[name] = value;
  }
  if (result.documentKind?.value) values.document_kind = result.documentKind.value;
  if (result.attributes.length > 0) {
    values.attributes = result.attributes.map(
      ({ key, label, value, sensitive }): KeyValueEntry => ({ key, label, value, sensitive }),
    );
    for (const entry of result.attributes) attributeConfidence[entry.key] = entry.confidence;
  }
  return { values, attributeConfidence };
}

/**
 * The fields whose seeded value came from the extraction (non-empty typed
 * fields, and `document_kind` when a kind was guessed), so the review form can
 * mark them "read by AI".
 */
export function documentAiSeededFields(result: ExtractDocumentResponse | null): Set<string> {
  const seeded = new Set<string>();
  if (!result) return seeded;
  for (const [name, value] of Object.entries(result.fields)) {
    if (typeof value === 'string' && value.trim() !== '') seeded.add(name);
  }
  if (result.documentKind?.value) seeded.add('document_kind');
  return seeded;
}

/**
 * Default name of the saved secret: `"<kind> · <holder first name>"` for an ID
 * document, `"Passport · <issuing country>"` for a passport. A missing part is
 * left out. Never a document number: a name is metadata shown in lists.
 */
export function buildDefaultDocumentName(
  documentType: ScannableDocumentType,
  values: Record<string, unknown>,
): string {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  if (documentType === 'passport') {
    const code = text(values.issuing_country);
    const country = code ? (findCountry(code)?.name ?? code) : '';
    return country ? `Passport · ${country}` : 'Passport';
  }
  const kind = text(values.document_kind) || 'ID document';
  const firstName = text(values.holder_name).split(/\s+/)[0]?.replace(/,$/, '') ?? '';
  return firstName ? `${kind} · ${firstName}` : kind;
}

/**
 * What became of the back photo's barcode in the last extraction: `decoded`
 * (sent with the request), `failed` (none could be read) or `skipped` (no back
 * photo, or a passport).
 *
 * @stability experimental
 */
export type DocumentBarcodeOutcome = 'decoded' | 'failed' | 'skipped';

/** Options of {@link UseDocumentScanResult.runExtraction}. @stability experimental */
export interface RunDocumentExtractionOptions {
  /**
   * The ORIGINAL back photo (full resolution, before any crop): an ID
   * document's PDF417 (AAMVA) barcode is decoded from it in the browser and
   * only the parsed values travel with the request.
   */
  backPhoto?: File | null;
}

export interface SaveDocumentInput {
  name: string;
  values: Record<string, unknown>;
  images: readonly CapturedDocumentImage[];
}

export interface SaveDocumentOutcome {
  secretId: string;
  /** Set when the document saved but one or more images could not be attached. */
  attachmentWarning: string | null;
}

export interface UseDocumentScanResult {
  documentType: ScannableDocumentType;
  /** Switch between ID document and passport; clears the photos and any result. */
  setDocumentType: (documentType: ScannableDocumentType) => void;
  /** The slots of the current type, in capture order. */
  slots: readonly DocumentImageSlot[];
  /** The captured full photos, by slot role. */
  photos: Partial<Record<DocumentScanSlot, CapturedDocumentPhoto>>;
  setPhoto: (slot: DocumentScanSlot, photo: CapturedDocumentPhoto | null) => void;

  /** The system type the current document saves as. */
  secretType: SecretType | null;
  isTypeLoading: boolean;
  typeError: string | null;

  extraction: ExtractDocumentResponse | null;
  extractionError: ScanErrorMessage | null;
  isExtracting: boolean;
  /** The back photo's barcode in the last extraction. */
  barcodeOutcome: DocumentBarcodeOutcome;
  /**
   * The model saw a barcode but the browser could not decode it: the page
   * suggests a closer, sharper back photo.
   */
  barcodeUnread: boolean;
  /**
   * Read the prepared FULL photos (data URLs by slot). For an ID document with
   * `options.backPhoto`, the back's PDF417 barcode is decoded first and its
   * parsed values sent along. NEVER REJECTS: a failure resolves to `null` and
   * lands in `extractionError`, so the caller always advances to review.
   */
  runExtraction: (
    images: Partial<Record<DocumentScanSlot, string>>,
    options?: RunDocumentExtractionOptions,
  ) => Promise<ExtractDocumentResponse | null>;

  isSaving: boolean;
  saveError: string | null;
  saveDocument: (input: SaveDocumentInput) => Promise<SaveDocumentOutcome | null>;
  /** Delete anything this flow created. Safe to call repeatedly. */
  abandonScan: () => Promise<void>;
}

/**
 * State, network and cleanup of the "Scan an ID" flow (`/documents/scan`).
 *
 * Holds the document type and the captured photos per slot; reads the photos
 * through `POST /api/secrets/documents/extract`; saves through the shared
 * {@link useSaveSecretWithImages} (create the secret, upload and link each
 * cropped slot image with its role, delete orphans, clean up on unmount). The
 * page owns the stage, the crops, the form values and the preview URLs.
 */
export function useDocumentScan(initialType: ScannableDocumentType = 'id_document'): UseDocumentScanResult {
  const [documentType, setDocumentTypeState] = useState<ScannableDocumentType>(initialType);
  const [photos, setPhotos] = useState<Partial<Record<DocumentScanSlot, CapturedDocumentPhoto>>>({});

  const { types, error: typesError, fetchTypes } = useSecretTypes();
  const [typesLoaded, setTypesLoaded] = useState(false);

  const [extraction, setExtraction] = useState<ExtractDocumentResponse | null>(null);
  const [extractionError, setExtractionError] = useState<ScanErrorMessage | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [barcodeOutcome, setBarcodeOutcome] = useState<DocumentBarcodeOutcome>('skipped');

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { saveSecretWithImages, cleanup } = useSaveSecretWithImages();

  useEffect(() => {
    let cancelled = false;
    void fetchTypes({ includeSystem: true }).then(() => {
      if (!cancelled) setTypesLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchTypes]);

  const typeName = DOCUMENT_SCAN_TYPE_NAMES[documentType];
  // There is no category column on SecretType: the system type is found by name.
  const secretType = useMemo(
    () => types.find((type) => type.isSystem && type.name === typeName) ?? null,
    [types, typeName],
  );
  const typeError = !typesLoaded
    ? null
    : (typesError ?? (secretType ? null : `The ${typeName} secret type is missing, so it cannot be scanned.`));

  const slots = useMemo(() => documentScanSlots(documentType), [documentType]);

  const setDocumentType = useCallback((next: ScannableDocumentType) => {
    setDocumentTypeState(next);
    setPhotos({});
    setExtraction(null);
    setExtractionError(null);
    setBarcodeOutcome('skipped');
  }, []);

  const setPhoto = useCallback((slot: DocumentScanSlot, photo: CapturedDocumentPhoto | null) => {
    setPhotos((prev) => {
      const next = { ...prev };
      if (photo) next[slot] = photo;
      else delete next[slot];
      return next;
    });
  }, []);

  const runExtraction = useCallback(
    async (
      images: Partial<Record<DocumentScanSlot, string>>,
      options: RunDocumentExtractionOptions = {},
    ): Promise<ExtractDocumentResponse | null> => {
      setIsExtracting(true);
      setExtractionError(null);
      setExtraction(null);
      try {
        // The barcode stays in memory: parsed values only, in this one request.
        const barcode =
          documentType === 'id_document' && options.backPhoto
            ? await readDriverLicenseBarcode(options.backPhoto)
            : null;
        setBarcodeOutcome(
          documentType === 'id_document' && options.backPhoto ? (barcode ? 'decoded' : 'failed') : 'skipped',
        );
        const result = await extractDocument(barcode ? { documentType, images, barcode } : { documentType, images });
        setExtraction(result);
        return result;
      } catch (err) {
        // A failed read is not a dead end: the review step opens with an empty
        // form and the photos already taken.
        setExtractionError(describeScanError(err, DOCUMENT_SCAN_SUBJECT));
        return null;
      } finally {
        setIsExtracting(false);
      }
    },
    [documentType],
  );

  const saveDocument = useCallback(
    async ({ name, values, images }: SaveDocumentInput): Promise<SaveDocumentOutcome | null> => {
      setIsSaving(true);
      setSaveError(null);
      try {
        if (!secretType) throw new Error(`The ${typeName} secret type is unavailable.`);
        const { secretId, failedRoles } = await saveSecretWithImages({
          name,
          typeId: secretType.id,
          data: cleanSecretData(secretType.fields, values),
          images: images.map((entry) => ({ role: entry.role, file: entry.image.file })),
        });
        const failedLabels = failedRoles.map(
          (role) => (slots.find((slot) => slot.role === role)?.label ?? role).toLowerCase(),
        );
        return {
          secretId,
          attachmentWarning:
            failedLabels.length > 0
              ? `The document was saved, but the ${failedLabels.join(' and ')} photo could not be attached.`
              : null,
        };
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Failed to save the document');
        return null;
      } finally {
        setIsSaving(false);
      }
    },
    [secretType, typeName, slots, saveSecretWithImages],
  );

  const abandonScan = useCallback(async () => {
    await cleanup();
  }, [cleanup]);

  return {
    documentType,
    setDocumentType,
    slots,
    photos,
    setPhoto,
    secretType,
    isTypeLoading: !typesLoaded,
    typeError,
    extraction,
    extractionError,
    isExtracting,
    barcodeOutcome,
    barcodeUnread: barcodeOutcome === 'failed' && extraction?.barcodePresent === true,
    runExtraction,
    isSaving,
    saveError,
    saveDocument,
    abandonScan,
  };
}
