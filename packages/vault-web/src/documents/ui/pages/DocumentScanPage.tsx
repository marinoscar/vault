import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  AlertTitle,
  Box,
  Breadcrumbs,
  Button,
  CircularProgress,
  Container,
  Link,
  Paper,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { AutoAwesomeOutlined as AiIcon } from '@mui/icons-material';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';
import type { DocumentImageSlot, DocumentScanSlot, ScanCropBoxWire } from '@marinoscar/vault-contract/secrets';

import { AiEgressNotice } from '../../../cards/ui/components/AiEgressNotice.js';
import { CardCaptureStep } from '../../../cards/ui/components/CardCaptureStep.js';
import { CardCropReview, type CardSideCrop } from '../../../cards/ui/components/CardCropReview.js';
import { CardFlowStepper, type CardFlowStep } from '../../../cards/ui/components/CardFlowStepper.js';
import {
  cropImageFileToBox,
  cropImageFileToCard,
  prepareCardPhoto,
  type CardAdjustments,
  type CroppedCardImage,
} from '../../../cards/headless/cardImage.js';
import { useAiStatus } from '../../../core/headless/useAiStatus.js';
import { AI_SETTINGS_PATH } from '../../../core/headless/scanErrors.js';
import { keyValueSuggestionsFor, validateSecretFields } from '../../../secrets/headless/secretFields.js';
import {
  DOCUMENT_LOW_CONFIDENCE_THRESHOLD,
  buildDefaultDocumentName,
  documentAiSeededFields,
  parseDocumentScanType,
  toDocumentReviewValues,
  useDocumentScan,
  type CapturedDocumentImage,
  type CapturedDocumentPhoto,
  type ScannableDocumentType,
} from '../../headless/useDocumentScan.js';
import { DocumentReviewForm } from '../components/DocumentReviewForm.js';

type Stage = 'capture' | 'processing' | 'crop' | 'review';

const STAGE_STEP: Record<Stage, CardFlowStep> = {
  capture: 'capture',
  processing: 'crop',
  crop: 'crop',
  review: 'review',
};

/** The subject of the capture copy ("Photograph the front of the document"). */
const SUBJECT: Record<ScannableDocumentType, string> = {
  passport: 'the passport',
  id_document: 'the document',
};

/**
 * "Scan an ID" (`/documents/scan?type=passport|id_document`).
 *
 * Capture (the type's image slots in order: front then the optional back, or
 * the data page then the optional other page) -> Crop (the AI reads the photos,
 * guesses the document kind and locates the document; the user checks the crop)
 * -> Review (typed fields, the kind with its "AI guessed" chip, the details)
 * -> Save. The card import's pieces are reused with the slot's aspect ratio.
 *
 * As for cards: the FULL photos go to the extraction endpoint and nowhere else;
 * only the crops are uploaded, and only on save. A failed read is not a dead
 * end: the review step opens with an empty form and the photos kept.
 */
export default function DocumentScanPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { hasPermission } = usePermissions();
  const { config: aiConfig, documentScanEnabled, canUseAi, isLoading: isStatusLoading } = useAiStatus();
  const canOpenAiSettings = hasPermission('ai_config:read');

  const scan = useDocumentScan(parseDocumentScanType(params.get('type')));
  const {
    documentType,
    setDocumentType,
    slots,
    photos,
    setPhoto,
    secretType,
    isTypeLoading,
    typeError,
    extraction,
    extractionError,
    isExtracting,
    runExtraction,
    isSaving,
    saveError,
    saveDocument,
    abandonScan,
  } = scan;

  const [stage, setStage] = useState<Stage>('capture');
  const [slotIndex, setSlotIndex] = useState(0);
  const [crops, setCrops] = useState<Partial<Record<DocumentScanSlot, CardSideCrop>>>({});
  const [isPreparing, setIsPreparing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [attributeConfidence, setAttributeConfidence] = useState<Record<string, number>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [editedFields, setEditedFields] = useState<Set<string>>(new Set());
  const [savedNotice, setSavedNotice] = useState<{ secretId: string; warning: string } | null>(null);

  // A run that finishes after Cancel must not move the (unmounting) page on.
  const runRef = useRef(0);

  // Preview object URLs, revoked explicitly (and on unmount, through a ref so
  // the cleanup sees the current set).
  const previewUrlsRef = useRef<Set<string>>(new Set());
  const trackUrl = useCallback((url: string) => {
    previewUrlsRef.current.add(url);
  }, []);
  const releaseUrl = useCallback((url: string | null | undefined) => {
    if (!url) return;
    previewUrlsRef.current.delete(url);
    URL.revokeObjectURL(url);
  }, []);
  useEffect(() => {
    const urls = previewUrlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const slot: DocumentImageSlot | undefined = slots[slotIndex];
  const capturedSlots = slots.filter((s) => photos[s.role as DocumentScanSlot]);

  const switchType = (next: ScannableDocumentType) => {
    if (next === documentType) return;
    for (const photo of Object.values(photos)) releaseUrl(photo?.previewUrl);
    for (const crop of Object.values(crops)) releaseUrl(crop?.image.previewUrl);
    setDocumentType(next);
    setCrops({});
    setSlotIndex(0);
    setCaptureError(null);
    setParams({ type: next }, { replace: true });
  };

  const handleFileSelected = async (role: DocumentScanSlot, file: File) => {
    setCaptureError(null);
    if (!file.type.startsWith('image/')) {
      setCaptureError('Please choose an image file.');
      return;
    }
    setIsPreparing(true);
    try {
      // The full frame, never cropped: the AI locates the document in it.
      const prepared = await prepareCardPhoto(file);
      const previewUrl = URL.createObjectURL(file);
      trackUrl(previewUrl);
      releaseUrl(photos[role]?.previewUrl);
      setPhoto(role, { file, prepared, previewUrl });
    } catch (err) {
      setCaptureError(err instanceof Error ? err.message : 'That photo could not be processed.');
    } finally {
      setIsPreparing(false);
    }
  };

  const handleRetake = (role: DocumentScanSlot) => {
    setCaptureError(null);
    releaseUrl(photos[role]?.previewUrl);
    setPhoto(role, null);
  };

  /** The stored crop of one slot: from the AI's box, else the centred auto-fit. */
  const renderInitialCrop = useCallback(
    async (target: DocumentImageSlot, photo: CapturedDocumentPhoto, box: ScanCropBoxWire | null) => {
      const fileName = `${documentType}-${target.role}.jpg`;
      const aspectRatio = target.aspectRatio;
      if (box) {
        try {
          const image = await cropImageFileToBox(photo.file, box, { fileName, aspectRatio });
          trackUrl(image.previewUrl);
          return { image, box, adjustments: null } satisfies CardSideCrop;
        } catch {
          // Unusable box: fall through to the auto-fit crop.
        }
      }
      try {
        const image = await cropImageFileToCard(photo.file, { fileName, aspectRatio });
        trackUrl(image.previewUrl);
        return { image, box: null, adjustments: null } satisfies CardSideCrop;
      } catch {
        return null;
      }
    },
    [documentType, trackUrl],
  );

  const goToReview = async (taken: Partial<Record<DocumentScanSlot, CapturedDocumentPhoto>>) => {
    const run = ++runRef.current;
    setStage('processing');
    const images: Partial<Record<DocumentScanSlot, string>> = {};
    for (const s of slots) {
      const photo = taken[s.role as DocumentScanSlot];
      if (photo) images[s.role as DocumentScanSlot] = photo.prepared.dataUrl;
    }
    const result = await runExtraction(images);
    if (run !== runRef.current) return;

    const nextCrops: Partial<Record<DocumentScanSlot, CardSideCrop>> = {};
    for (const s of slots) {
      const role = s.role as DocumentScanSlot;
      const photo = taken[role];
      if (!photo) continue;
      const crop = await renderInitialCrop(s, photo, result?.crops?.[role] ?? null);
      if (crop) nextCrops[role] = crop;
    }
    if (run !== runRef.current) return;
    for (const crop of Object.values(crops)) releaseUrl(crop?.image.previewUrl);
    setCrops(nextCrops);

    const seed = toDocumentReviewValues(result);
    setValues(seed.values);
    setAttributeConfidence(seed.attributeConfidence);
    setName(buildDefaultDocumentName(documentType, seed.values));
    setEditedFields(new Set());
    setFieldErrors({});
    setStage(Object.keys(nextCrops).length > 0 ? 'crop' : 'review');
  };

  const handleCropChange = (role: DocumentScanSlot, image: CroppedCardImage, adjustments: CardAdjustments) => {
    trackUrl(image.previewUrl);
    releaseUrl(crops[role]?.image.previewUrl);
    setCrops((prev) => ({ ...prev, [role]: { image, box: prev[role]?.box ?? null, adjustments } }));
  };

  const handleCancel = async () => {
    runRef.current += 1;
    await abandonScan();
    navigate('/secrets');
  };

  const handleValuesChange = (next: Record<string, unknown>) => {
    const changed = Object.keys({ ...values, ...next }).filter((key) => next[key] !== values[key]);
    setValues(next);
    setEditedFields((prev) => {
      const updated = new Set(prev);
      for (const key of changed) updated.add(key);
      return updated;
    });
    setFieldErrors((prev) => {
      const remaining = Object.fromEntries(Object.entries(prev).filter(([key]) => !changed.includes(key)));
      return Object.keys(remaining).length === Object.keys(prev).length ? prev : remaining;
    });
  };

  // Values the AI supplied and the user has not touched since.
  const aiFields = useMemo(() => {
    const seeded = documentAiSeededFields(extraction);
    for (const field of editedFields) seeded.delete(field);
    return seeded;
  }, [extraction, editedFields]);

  const lowConfidenceFields = useMemo(() => {
    const flagged = new Set<string>();
    if (!extraction) return flagged;
    for (const [field, score] of Object.entries(extraction.confidence)) {
      if (aiFields.has(field) && score <= DOCUMENT_LOW_CONFIDENCE_THRESHOLD) flagged.add(field);
    }
    const kind = extraction.documentKind;
    if (kind?.value && aiFields.has('document_kind') && kind.confidence <= DOCUMENT_LOW_CONFIDENCE_THRESHOLD) {
      flagged.add('document_kind');
    }
    return flagged;
  }, [extraction, aiFields]);

  const flaggedAttributes = useMemo(
    () =>
      new Set(
        Object.entries(attributeConfidence)
          .filter(([, score]) => score <= DOCUMENT_LOW_CONFIDENCE_THRESHOLD)
          .map(([key]) => key),
      ),
    [attributeConfidence],
  );

  // The chosen kind's standard keys, offered without dropping entered entries.
  const suggestions = keyValueSuggestionsFor(secretType, values);

  const handleSave = async () => {
    if (!secretType) return;
    const errors = validateSecretFields(secretType.fields, values);
    if (!name.trim()) errors.__name = 'A name is required';
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    const images: CapturedDocumentImage[] = [];
    for (const s of slots) {
      const crop = crops[s.role as DocumentScanSlot];
      if (crop) images.push({ role: s.role, image: crop.image });
    }
    const outcome = await saveDocument({ name, values, images });
    if (!outcome) return;
    if (outcome.attachmentWarning) {
      setSavedNotice({ secretId: outcome.secretId, warning: outcome.attachmentWarning });
      return;
    }
    navigate(`/secrets/${outcome.secretId}`);
  };

  // ---------------------------------------------------------------------------
  // Gating
  // ---------------------------------------------------------------------------

  const breadcrumbs = (
    <Breadcrumbs sx={{ mb: 1 }}>
      <Link component={RouterLink} color="inherit" to="/secrets">
        Secrets
      </Link>
      <Typography sx={{ color: 'text.primary' }}>Scan an ID</Typography>
    </Breadcrumbs>
  );

  if (isStatusLoading) {
    return (
      <Container maxWidth="md" sx={{ py: 6, textAlign: 'center' }}>
        <CircularProgress aria-label="Loading" />
      </Container>
    );
  }

  if (!documentScanEnabled) {
    // The card import's three reasons; no key input anywhere on this page.
    const reason: 'forbidden' | 'off' | 'not_set_up' = !canUseAi
      ? 'forbidden'
      : aiConfig.enabled === true
        ? 'not_set_up'
        : 'off';
    const text = {
      forbidden: {
        title: 'Document scanning is not available to you',
        detail: 'Your role does not include AI features. You can still add the document by typing its details.',
      },
      off: {
        title: 'AI is off',
        detail: 'AI is off — an admin can turn it on in Console → AI.',
      },
      not_set_up: {
        title: 'AI is not set up yet',
        detail:
          'AI is not set up yet — an administrator needs to add the OpenAI key and choose the document scanning model in Console → AI.',
      },
    }[reason];
    const manualPath = secretType ? `/secrets/new?type=${encodeURIComponent(secretType.id)}` : '/secrets/new';
    return (
      <Container maxWidth="md" disableGutters>
        {breadcrumbs}
        <Alert severity="info" sx={{ mt: 1 }}>
          <AlertTitle>{text.title}</AlertTitle>
          {text.detail}
          <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {canOpenAiSettings && reason !== 'forbidden' && (
              <Button variant="contained" onClick={() => navigate(AI_SETTINGS_PATH)}>
                Open Console → AI
              </Button>
            )}
            <Button variant="outlined" onClick={() => navigate(manualPath)}>
              Add manually
            </Button>
            <Button color="inherit" onClick={() => navigate('/secrets')}>
              Back to secrets
            </Button>
          </Box>
        </Alert>
      </Container>
    );
  }

  // ---------------------------------------------------------------------------
  // Wizard
  // ---------------------------------------------------------------------------

  const subject = SUBJECT[documentType];
  const cropSides = capturedSlots.map((s) => ({
    side: s.role as DocumentScanSlot,
    label: s.label,
    aspectRatio: s.aspectRatio,
    file: photos[s.role as DocumentScanSlot]!.file,
    crop: crops[s.role as DocumentScanSlot] ?? null,
  }));
  const activeStep: CardFlowStep = isSaving || savedNotice ? 'save' : STAGE_STEP[stage];
  const readCount = documentAiSeededFields(extraction).size;
  const isLastSlot = slotIndex >= slots.length - 1;

  return (
    <Container maxWidth="md" disableGutters>
      {breadcrumbs}

      <Typography variant="h4" component="h1" sx={{ fontSize: { xs: '1.75rem', sm: '2.125rem' } }}>
        Scan an ID
      </Typography>

      <CardFlowStepper active={activeStep} done={Boolean(savedNotice)} />

      {typeError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {typeError}
        </Alert>
      )}

      {savedNotice ? (
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
          <Alert severity="warning" sx={{ mb: 2 }}>
            <AlertTitle>Document saved, photos not attached</AlertTitle>
            {savedNotice.warning}
          </Alert>
          <Button variant="contained" onClick={() => navigate(`/secrets/${savedNotice.secretId}`)}>
            View the document
          </Button>
        </Paper>
      ) : stage === 'capture' && slot ? (
        <>
          <ToggleButtonGroup
            exclusive
            size="small"
            color="primary"
            value={documentType}
            onChange={(_event, next: ScannableDocumentType | null) => {
              if (next) switchType(next);
            }}
            aria-label="Document type"
            disabled={isPreparing}
            sx={{ mb: 2, display: 'flex', '& .MuiToggleButton-root': { flex: { xs: 1, sm: 'none' }, minHeight: 40 } }}
          >
            <ToggleButton value="id_document">ID document</ToggleButton>
            <ToggleButton value="passport">Passport</ToggleButton>
          </ToggleButtonGroup>

          <AiEgressNotice variant="document" />

          <CardCaptureStep
            key={`${documentType}-${slot.role}`}
            side={slot.role}
            slotLabel={slot.label}
            subject={subject}
            aspectRatio={slot.aspectRatio}
            testIdPrefix="document"
            optional={!slot.required}
            photo={photos[slot.role as DocumentScanSlot] ?? null}
            isProcessing={isPreparing}
            error={captureError}
            onFileSelected={(file) => void handleFileSelected(slot.role as DocumentScanSlot, file)}
            onRetake={() => handleRetake(slot.role as DocumentScanSlot)}
            continueLabel={isLastSlot ? 'Read the document' : 'Continue'}
            onContinue={() => {
              if (isLastSlot) void goToReview(photos);
              else setSlotIndex(slotIndex + 1);
            }}
            onSkip={
              slot.required
                ? undefined
                : () => {
                    const role = slot.role as DocumentScanSlot;
                    releaseUrl(photos[role]?.previewUrl);
                    setPhoto(role, null);
                    const rest = { ...photos };
                    delete rest[role];
                    if (isLastSlot) void goToReview(rest);
                    else setSlotIndex(slotIndex + 1);
                  }
            }
            skipLabel={`Skip the ${slot.label.toLowerCase()}`}
            onCancel={() => void handleCancel()}
          />
        </>
      ) : stage === 'processing' ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }} aria-live="polite">
          <CircularProgress sx={{ mb: 2 }} />
          <Typography variant="h6" component="h2" gutterBottom>
            Reading the document…
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            {isExtracting
              ? 'Your photos have been sent to the configured AI model, which tells what kind of document it is, locates it and reads the printed details. This usually takes a few seconds.'
              : 'Cropping the photos to the document…'}
          </Typography>
          <Button color="inherit" onClick={() => void handleCancel()} sx={{ minHeight: 44 }}>
            Cancel
          </Button>
        </Paper>
      ) : stage === 'crop' ? (
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
          <Typography variant="h6" component="h2" gutterBottom>
            Check the crop
          </Typography>
          {extractionError || extraction?.partial ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              The details could not be read automatically. You can type them in on the next step; your
              photos are kept.
            </Alert>
          ) : readCount > 0 ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, color: 'text.secondary' }}>
              <AiIcon fontSize="small" sx={{ color: 'primary.main' }} />
              <Typography variant="body2">
                {readCount} detail{readCount === 1 ? '' : 's'} read from the photos. You will check them on
                the next step.
              </Typography>
            </Box>
          ) : null}

          <CardCropReview<DocumentScanSlot>
            sides={cropSides}
            subjectNoun="document"
            onCropChange={handleCropChange}
          />

          <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1 }}>
            <Button variant="contained" onClick={() => setStage('review')} sx={{ minHeight: 44 }}>
              Continue to details
            </Button>
            <Button
              variant="outlined"
              onClick={() => {
                setSlotIndex(0);
                setStage('capture');
              }}
              sx={{ minHeight: 44 }}
            >
              Retake photos
            </Button>
            <Box sx={{ flexGrow: 1, display: { xs: 'none', sm: 'block' } }} />
            <Button color="inherit" onClick={() => void handleCancel()} sx={{ minHeight: 44 }}>
              Cancel
            </Button>
          </Box>
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
          <Typography variant="h6" component="h2" gutterBottom>
            Check the details
          </Typography>

          {extractionError && (
            <Alert
              severity={extractionError.adminActionRequired ? 'warning' : 'error'}
              sx={{ mb: 2 }}
              action={
                extractionError.retryable ? (
                  <Button color="inherit" size="small" onClick={() => void goToReview(photos)}>
                    Try again
                  </Button>
                ) : undefined
              }
            >
              <AlertTitle>{extractionError.title}</AlertTitle>
              {extractionError.detail}
              {extractionError.adminLink && canOpenAiSettings && (
                <Box sx={{ mt: 1 }}>
                  <Link component={RouterLink} to={extractionError.adminLink.to}>
                    {extractionError.adminLink.label}
                  </Link>
                </Box>
              )}
              <Typography variant="body2" sx={{ mt: 1 }}>
                Your photos were kept — fill the details in below and they will be attached to the document.
              </Typography>
            </Alert>
          )}

          {extraction?.partial && !extractionError && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Nothing legible came back from the photos. Enter the details below.
            </Alert>
          )}

          {saveError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {saveError}
            </Alert>
          )}

          <CardCropReview<DocumentScanSlot>
            compact
            sides={cropSides}
            subjectNoun="document"
            disabled={isSaving}
            onEdit={() => setStage('crop')}
            onCropChange={handleCropChange}
          />

          {aiFields.size > 0 && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1,
                mb: 2,
                p: 1.5,
                borderRadius: 1,
                borderLeft: 3,
                borderColor: 'primary.main',
                bgcolor: 'action.hover',
              }}
            >
              <AiIcon fontSize="small" sx={{ color: 'primary.main', mt: 0.25 }} />
              <Typography variant="body2">
                Fields marked <strong>AI</strong> were read from your photos; fields marked{' '}
                <strong>Check</strong> were hard to read. Compare them with the document.
              </Typography>
            </Box>
          )}

          <TextField
            fullWidth
            required
            label="Name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setFieldErrors((prev) => {
                if (!prev.__name) return prev;
                const next = { ...prev };
                delete next.__name;
                return next;
              });
            }}
            error={Boolean(fieldErrors.__name)}
            helperText={fieldErrors.__name ?? 'Shown in your secrets list. Never put the document number here.'}
            disabled={isSaving}
            sx={{ mb: 2 }}
          />

          {isTypeLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress aria-label="Loading the document type" />
            </Box>
          ) : (
            <DocumentReviewForm
              fields={secretType?.fields ?? []}
              values={values}
              onChange={handleValuesChange}
              aiFields={aiFields}
              lowConfidenceFields={lowConfidenceFields}
              kindConfidence={extraction?.documentKind?.confidence ?? null}
              flaggedAttributes={flaggedAttributes}
              keyValueSuggestions={suggestions}
              checks={extraction?.checks ?? []}
              warnings={extraction?.warnings ?? []}
              errors={fieldErrors}
              disabled={isSaving}
            />
          )}

          <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1, mt: 3 }}>
            <Button
              variant="contained"
              onClick={() => void handleSave()}
              disabled={isSaving || !secretType}
              sx={{ minHeight: 44 }}
            >
              {isSaving ? 'Saving…' : 'Save document'}
            </Button>
            <Box sx={{ flexGrow: 1, display: { xs: 'none', sm: 'block' } }} />
            <Button color="inherit" onClick={() => void handleCancel()} disabled={isSaving} sx={{ minHeight: 44 }}>
              Cancel
            </Button>
          </Box>
        </Paper>
      )}
    </Container>
  );
}
