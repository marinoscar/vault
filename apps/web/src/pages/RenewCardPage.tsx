import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  AlertTitle,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  CircularProgress,
  Container,
  Link,
  Paper,
  Step,
  StepLabel,
  Stepper,
  Typography,
} from '@mui/material';

import { AiEgressNotice } from '../components/cards/AiEgressNotice';
import { CardCaptureStep } from '../components/cards/CardCaptureStep';
import { CardCropReview, type CardSideCrop } from '../components/cards/CardCropReview';
import { CardReviewForm } from '../components/cards/CardReviewForm';
import { useAiStatus } from '../hooks/useAiStatus';
import {
  LOW_CONFIDENCE_THRESHOLD,
  type CapturedCardPhoto,
  type CapturedCardSide,
} from '../hooks/useCardImport';
import {
  CVV_FIELD,
  diffCardFields,
  toRenewalValues,
  useCardRenewal,
} from '../hooks/useCardRenewal';
import type { CardCropBox } from '../types';
import {
  cropImageFileToBox,
  cropImageFileToCard,
  prepareCardPhoto,
  type CardAdjustments,
  type CroppedCardImage,
} from '../utils/cardImage';

type Stage = 'front' | 'back' | 'processing' | 'review';

/**
 * Renew a card in place, creating a new version.
 *
 * Front capture -> back capture -> (optional AI read) -> per-field diff -> renew.
 *
 * The capture steps collect FULL photos, exactly as the import wizard now
 * does: the prepared full frame goes to the extraction endpoint, the AI
 * returns a bounding box per side, and the stored attachment is cropped from
 * that box (adjustable on the diff step). With AI off, any photo is cropped by
 * the centred auto-fit instead — still adjustable. Only the cropped version is
 * ever uploaded to storage.
 *
 * Three things separate this from the import wizard, and each one is load-bearing:
 *
 *  1. THE DIFF. The user is not entering a card, they are replacing one they
 *     already hold. The review step therefore shows current-vs-proposed per
 *     field, so what changes (number, expiry, code) and what does not
 *     (cardholder, network) is visible before anything is committed.
 *  2. IT WORKS WITHOUT AI. Only the extraction step is gated on `useAiStatus`.
 *     A reissued card arrives whether or not an administrator has configured an
 *     OpenAI key, so with AI off the same wizard runs with the photo steps
 *     optional and every value typed by hand. Gating the page itself would make
 *     the feature unreachable for exactly the users who cannot fix it.
 *  3. PHOTOS ARE OPTIONAL THROUGHOUT. A renewal with no new photos carries the
 *     old version's images forward server-side, which is what keeps the old
 *     card readable in its own version of the history.
 *
 * The CVV rule is narrower than it looks: the OUTGOING card's code is never
 * carried forward, because a reissued card always has a new one. A code read
 * from the new card's photo does seed the field, and saving stays blocked
 * until the field holds something either way.
 */
export default function RenewCardPage() {
  const navigate = useNavigate();
  const { id: secretId } = useParams<{ id: string }>();
  const { cardExtractEnabled, isLoading: isAiStatusLoading } = useAiStatus();
  const {
    secret,
    fields,
    currentValues,
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
  } = useCardRenewal(secretId);

  const [stage, setStage] = useState<Stage>('front');
  const [frontPhoto, setFrontPhoto] = useState<CapturedCardPhoto | null>(null);
  const [backPhoto, setBackPhoto] = useState<CapturedCardPhoto | null>(null);
  const [frontCrop, setFrontCrop] = useState<CardSideCrop | null>(null);
  const [backCrop, setBackCrop] = useState<CardSideCrop | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [editedFields, setEditedFields] = useState<Set<string>>(new Set());

  // Object URLs (full-photo previews AND crop previews) are revoked
  // explicitly, and tracked in a ref so the unmount cleanup sees the current
  // set rather than a stale closure.
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

  /**
   * Extraction is available only when the feature is on AND the check has
   * resolved. Treating "still loading" as unavailable fails closed on the only
   * thing that matters here — nothing is sent to OpenAI on an unresolved check
   * — and costs nothing, because reaching the read step takes two deliberate
   * clicks by which time the two-boolean status call has landed.
   */
  const canExtract = !isAiStatusLoading && cardExtractEnabled;

  const stepLabels = canExtract
    ? ['Front', 'Back', 'Read', 'Review']
    : ['Front', 'Back', 'Review'];

  const stepIndex = canExtract
    ? { front: 0, back: 1, processing: 2, review: 3 }[stage]
    : { front: 0, back: 1, processing: 2, review: 2 }[stage];

  // What gets uploaded on renew: the CROPPED images, never the full photos.
  const capturedSides: CapturedCardSide[] = useMemo(() => {
    const sides: CapturedCardSide[] = [];
    if (frontCrop) sides.push({ role: 'card_front', image: frontCrop.image });
    if (backCrop) sides.push({ role: 'card_back', image: backCrop.image });
    return sides;
  }, [frontCrop, backCrop]);

  const handleFileSelected = async (side: 'front' | 'back', file: File) => {
    setCaptureError(null);

    if (!file.type.startsWith('image/')) {
      setCaptureError('Please choose an image file.');
      return;
    }

    setIsPreparing(true);
    try {
      // Full frame only — the crop for the stored attachment happens after
      // the AI locates the card (or via the auto-fit when AI is off). The
      // full photo goes to the extraction endpoint and nowhere else; it is
      // never uploaded to storage.
      const prepared = await prepareCardPhoto(file);
      const previewUrl = URL.createObjectURL(file);
      trackUrl(previewUrl);
      const photo: CapturedCardPhoto = { file, prepared, previewUrl };
      if (side === 'front') {
        releaseUrl(frontPhoto?.previewUrl);
        setFrontPhoto(photo);
      } else {
        releaseUrl(backPhoto?.previewUrl);
        setBackPhoto(photo);
      }
    } catch (err) {
      setCaptureError(
        err instanceof Error ? err.message : 'That photo could not be processed.',
      );
    } finally {
      setIsPreparing(false);
    }
  };

  const handleRetake = (side: 'front' | 'back') => {
    setCaptureError(null);
    if (side === 'front') {
      releaseUrl(frontPhoto?.previewUrl);
      setFrontPhoto(null);
    } else {
      releaseUrl(backPhoto?.previewUrl);
      setBackPhoto(null);
    }
  };

  /**
   * Render the initial stored-attachment crop for one side: from the AI's box
   * when one came back, otherwise the centred auto-fit. A failed box crop
   * falls back to the auto-fit rather than losing the side.
   */
  const renderInitialCrop = useCallback(
    async (
      side: 'front' | 'back',
      photo: CapturedCardPhoto,
      box: CardCropBox | null,
    ): Promise<CardSideCrop | null> => {
      const fileName = `card-${side}.jpg`;
      if (box) {
        try {
          const image = await cropImageFileToBox(photo.file, box, { fileName });
          trackUrl(image.previewUrl);
          return { image, box, adjustments: null };
        } catch {
          // Degenerate or unusable box — fall through to the auto-fit crop.
        }
      }
      try {
        const image = await cropImageFileToCard(photo.file, { fileName });
        trackUrl(image.previewUrl);
        return { image, box: null, adjustments: null };
      } catch {
        return null;
      }
    },
    [trackUrl],
  );

  /**
   * Move to the diff, reading the card first when that is possible.
   *
   * The read is skipped — silently and without an error — when the feature is
   * off or when there is no front photo to read. Either way any photo taken is
   * cropped for the new version's attachment, the form is seeded from the
   * outgoing card, and the user edits by hand.
   */
  const goToReview = async (
    front: CapturedCardPhoto | null,
    back: CapturedCardPhoto | null,
  ) => {
    setStage('processing');

    const result =
      canExtract && front
        ? await runExtraction({
            front: front.prepared.dataUrl,
            back: back?.prepared.dataUrl,
          })
        : null;

    const nextFront = front
      ? await renderInitialCrop('front', front, result?.crops?.front ?? null)
      : null;
    const nextBack = back
      ? await renderInitialCrop('back', back, result?.crops?.back ?? null)
      : null;
    releaseUrl(frontCrop?.image.previewUrl);
    releaseUrl(backCrop?.image.previewUrl);
    setFrontCrop(nextFront);
    setBackCrop(nextBack);

    setValues(toRenewalValues(currentValues, result));
    setEditedFields(new Set());
    setFieldErrors({});
    setStage('review');
  };

  /** The user re-cropped a side in the diff step's adjuster. */
  const handleCropChange = (
    side: 'front' | 'back',
    image: CroppedCardImage,
    adjustments: CardAdjustments,
  ) => {
    trackUrl(image.previewUrl);
    if (side === 'front') {
      releaseUrl(frontCrop?.image.previewUrl);
      setFrontCrop((prev) => ({ image, box: prev?.box ?? null, adjustments }));
    } else {
      releaseUrl(backCrop?.image.previewUrl);
      setBackCrop((prev) => ({ image, box: prev?.box ?? null, adjustments }));
    }
  };

  const handleCancel = async () => {
    // Nothing is created until the single renew call, so abandoning only has to
    // drop uploads — there is never a half-made version to remove.
    await abandonRenewal();
    navigate(secretId ? `/secrets/${secretId}` : '/cards');
  };

  const handleFieldChange = (field: string, value: string) => {
    setValues((prev) => ({ ...(prev ?? {}), [field]: value }));
    setEditedFields((prev) => new Set(prev).add(field));
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const lowConfidenceFields = useMemo(() => {
    const flagged = new Set<string>();
    if (!extraction?.confidence || !values) return flagged;
    for (const [field, score] of Object.entries(extraction.confidence)) {
      if (editedFields.has(field)) continue;
      if ((values[field] ?? '') === '') continue;
      // A value the extraction was unsure about but which matches the card we
      // already hold needs no checking — the old version corroborates it.
      if (values[field] === currentValues[field]) continue;
      if (score <= LOW_CONFIDENCE_THRESHOLD) flagged.add(field);
    }
    return flagged;
  }, [extraction, values, editedFields, currentValues]);

  const changes = useMemo(
    () => (values ? diffCardFields(fields, currentValues, values) : []),
    [fields, currentValues, values],
  );
  const changedCount = changes.filter((change) => change.changed).length;

  const cvvEntered = (values?.[CVV_FIELD] ?? '').trim() !== '';
  const hasCvvField = fields.some((field) => field.name === CVV_FIELD);
  const canSubmit = !isSubmitting && (!hasCvvField || cvvEntered);

  const handleSubmit = async () => {
    if (!values || !secret) return;

    const errors: Record<string, string> = {};
    for (const field of fields) {
      if (field.required && (values[field.name] ?? '').trim() === '') {
        errors[field.name] = `${field.label} is required`;
      }
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    const renewed = await submitRenewal({
      values,
      images: capturedSides,
      // The extraction actually used, so `aiAssisted` reports what happened
      // rather than what was available. Null on a manual renewal.
      extraction,
    });
    if (!renewed) return;

    // Land on the detail page: it shows the new current version AND the version
    // history, which is where the old card's number and photos remain readable.
    navigate(`/secrets/${renewed.id ?? secretId}`, {
      state: { renewed: true },
    });
  };

  // ---------------------------------------------------------------------------
  // Loading / failure
  // ---------------------------------------------------------------------------

  const breadcrumbs = (
    <Breadcrumbs sx={{ mb: 2 }}>
      <Link
        color="inherit"
        href="/cards"
        onClick={(e) => {
          e.preventDefault();
          navigate('/cards');
        }}
      >
        Cards
      </Link>
      <Typography color="text.primary">Renew</Typography>
    </Breadcrumbs>
  );

  // NOTE: there is deliberately no AI availability gate here. The only thing
  // `cardExtractEnabled` decides is whether the photos are read automatically.
  if (isLoading) {
    return (
      <Container maxWidth="md" sx={{ py: 6, textAlign: 'center' }}>
        <CircularProgress aria-label="Loading the card" />
      </Container>
    );
  }

  if (loadError || !secret) {
    return (
      <Container maxWidth="md" sx={{ py: 3 }}>
        {breadcrumbs}
        <Alert severity="error">
          <AlertTitle>This card could not be loaded</AlertTitle>
          {loadError ?? 'The card was not found.'}
          <Box sx={{ mt: 2 }}>
            <Button variant="outlined" onClick={() => navigate('/cards')}>
              Back to cards
            </Button>
          </Box>
        </Alert>
      </Container>
    );
  }

  // ---------------------------------------------------------------------------
  // Wizard
  // ---------------------------------------------------------------------------

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      {breadcrumbs}

      <Typography variant="h4" gutterBottom>
        Renew {secret.name}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Saves a new version. The current card — its number, name and photos —
        stays readable in this card's version history.
      </Typography>

      <Stepper activeStep={stepIndex} sx={{ my: 3 }} alternativeLabel>
        {stepLabels.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {stage === 'front' || stage === 'back' ? (
        <>
          {canExtract ? (
            <AiEgressNotice />
          ) : (
            <Alert severity="info" sx={{ mb: 2 }}>
              <AlertTitle>Photos are not read automatically</AlertTitle>
              AI card reading is off, so nothing is sent to OpenAI. Any photo you
              add is cropped to the card and stored with the new version, and
              you type the new details yourself on the next step.
            </Alert>
          )}

          {stage === 'front' ? (
            <CardCaptureStep
              side="front"
              photo={frontPhoto}
              isProcessing={isPreparing}
              error={captureError}
              heading="Photograph the front of the new card (optional)"
              helpText={
                canExtract
                  ? 'Make sure every corner of the card is in the shot and the text is readable. The new photo replaces the front image on this card; the old version keeps its own. Skip it to type the details instead.'
                  : 'Make sure every corner of the card is in the shot and the text is readable. The new photo replaces the front image on this card; the old version keeps its own. Skip it if you are only updating the details.'
              }
              continueLabel="Continue"
              skipLabel="Skip the photo"
              onFileSelected={(file) => void handleFileSelected('front', file)}
              onRetake={() => handleRetake('front')}
              onContinue={() => setStage('back')}
              // Present on the FRONT step too, unlike import: a renewal with no
              // new photos at all is a legitimate, common case (a reissued card
              // with the same design, or a user who would rather not photograph
              // it), and it is the only way the flow works with AI off and no
              // camera to hand.
              onSkip={() => {
                releaseUrl(frontPhoto?.previewUrl);
                setFrontPhoto(null);
                setStage('back');
              }}
              onCancel={() => void handleCancel()}
            />
          ) : (
            <CardCaptureStep
              side="back"
              photo={backPhoto}
              isProcessing={isPreparing}
              error={captureError}
              heading="Photograph the back of the new card (optional)"
              helpText="Make sure every corner of the card is in the shot. The new photo replaces the back image on this card; the old version keeps its own."
              continueLabel={canExtract && frontPhoto ? 'Read the card' : 'Continue'}
              skipLabel="Skip the photo"
              onFileSelected={(file) => void handleFileSelected('back', file)}
              onRetake={() => handleRetake('back')}
              onContinue={() => void goToReview(frontPhoto, backPhoto)}
              onSkip={() => {
                releaseUrl(backPhoto?.previewUrl);
                setBackPhoto(null);
                void goToReview(frontPhoto, null);
              }}
              onCancel={() => void handleCancel()}
            />
          )}
        </>
      ) : stage === 'processing' ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <CircularProgress sx={{ mb: 2 }} />
          <Typography variant="h6" gutterBottom>
            {isExtracting ? 'Reading the new card…' : 'Preparing the photos…'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {isExtracting
              ? 'Your photos have been sent to OpenAI, which locates the card and reads the printed details. This usually takes a few seconds.'
              : 'Cropping the photos to the card…'}
          </Typography>
        </Paper>
      ) : (
        <Paper sx={{ p: { xs: 2, md: 3 } }}>
          <Typography variant="h6" gutterBottom>
            Check what changes
          </Typography>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
            <Chip
              size="small"
              color={changedCount > 0 ? 'primary' : 'default'}
              label={
                changedCount === 0
                  ? 'Nothing changes yet'
                  : `${changedCount} field${changedCount === 1 ? '' : 's'} change`
              }
            />
            <Typography variant="body2" color="text.secondary">
              Everything else is saved exactly as it is now.
            </Typography>
          </Box>

          {extractionError && (
            <Alert
              severity={extractionError.adminActionRequired ? 'warning' : 'error'}
              sx={{ mb: 2 }}
              action={
                extractionError.retryable ? (
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => void goToReview(frontPhoto, backPhoto)}
                  >
                    Try again
                  </Button>
                ) : undefined
              }
            >
              <AlertTitle>{extractionError.title}</AlertTitle>
              {extractionError.detail}
              <Typography variant="body2" sx={{ mt: 1 }}>
                The current card's details are still below — edit whatever the
                new card changed and renew as normal.
              </Typography>
            </Alert>
          )}

          {extraction?.partial && !extractionError && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Nothing legible came back from the photos. Edit the details below
              by hand.
            </Alert>
          )}

          {submitError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {submitError}
            </Alert>
          )}

          <CardCropReview
            sides={[
              ...(frontPhoto
                ? [{ side: 'front' as const, file: frontPhoto.file, crop: frontCrop }]
                : []),
              ...(backPhoto
                ? [{ side: 'back' as const, file: backPhoto.file, crop: backCrop }]
                : []),
            ]}
            disabled={isSubmitting}
            onCropChange={handleCropChange}
          />

          <CardReviewForm
            fields={fields}
            values={values ?? {}}
            onChange={handleFieldChange}
            lowConfidenceFields={lowConfidenceFields}
            warnings={extraction?.warnings ?? []}
            errors={fieldErrors}
            disabled={isSubmitting}
            currentValues={currentValues}
            notCarriedForwardField={CVV_FIELD}
          />

          {hasCvvField && !cvvEntered && (
            <Alert severity="info" sx={{ mt: 2 }}>
              Enter the CVV / CVC from the new card to renew. It could not be
              read from a photo, and the old card's code is never reused, so
              type it from the new card yourself.
            </Alert>
          )}

          <Box sx={{ display: 'flex', gap: 1, mt: 3, flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
            >
              {isSubmitting ? 'Renewing…' : 'Renew card'}
            </Button>
            <Box sx={{ flexGrow: 1 }} />
            <Button
              color="inherit"
              onClick={() => void handleCancel()}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
          </Box>
        </Paper>
      )}
    </Container>
  );
}
