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
import { CardReviewForm } from '../components/cards/CardReviewForm';
import { useAiStatus } from '../hooks/useAiStatus';
import {
  LOW_CONFIDENCE_THRESHOLD,
  type CapturedCardSide,
} from '../hooks/useCardImport';
import {
  CVV_FIELD,
  diffCardFields,
  toRenewalValues,
  useCardRenewal,
} from '../hooks/useCardRenewal';
import { cropImageFileToCard, type CroppedCardImage } from '../utils/cardImage';

type Stage = 'front' | 'back' | 'processing' | 'review';

/**
 * Renew a card in place, creating a new version.
 *
 * Front capture -> back capture -> (optional AI read) -> per-field diff -> renew.
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
 * The CVV rule from the import wizard is unchanged: it is never seeded and
 * never carried forward, and saving is blocked until it is typed.
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
  const [frontImage, setFrontImage] = useState<CroppedCardImage | null>(null);
  const [backImage, setBackImage] = useState<CroppedCardImage | null>(null);
  const [isCropping, setIsCropping] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [editedFields, setEditedFields] = useState<Set<string>>(new Set());

  // Preview object URLs are revoked explicitly, and tracked in a ref so the
  // unmount cleanup sees the current set rather than a stale closure.
  const previewUrlsRef = useRef<Set<string>>(new Set());

  const trackPreview = useCallback((image: CroppedCardImage | null) => {
    if (image) previewUrlsRef.current.add(image.previewUrl);
  }, []);

  const releasePreview = useCallback((image: CroppedCardImage | null) => {
    if (!image) return;
    previewUrlsRef.current.delete(image.previewUrl);
    URL.revokeObjectURL(image.previewUrl);
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

  const capturedSides: CapturedCardSide[] = useMemo(() => {
    const sides: CapturedCardSide[] = [];
    if (frontImage) sides.push({ role: 'card_front', image: frontImage });
    if (backImage) sides.push({ role: 'card_back', image: backImage });
    return sides;
  }, [frontImage, backImage]);

  const handleFileSelected = async (side: 'front' | 'back', file: File) => {
    setCaptureError(null);

    if (!file.type.startsWith('image/')) {
      setCaptureError('Please choose an image file.');
      return;
    }

    setIsCropping(true);
    try {
      // Cropped here, before anything leaves the device — the uncropped frame
      // is never uploaded and never sent for extraction.
      const cropped = await cropImageFileToCard(file, {
        fileName: `card-${side}.jpg`,
      });
      trackPreview(cropped);
      if (side === 'front') {
        releasePreview(frontImage);
        setFrontImage(cropped);
      } else {
        releasePreview(backImage);
        setBackImage(cropped);
      }
    } catch (err) {
      setCaptureError(
        err instanceof Error ? err.message : 'That photo could not be processed.',
      );
    } finally {
      setIsCropping(false);
    }
  };

  const handleRetake = (side: 'front' | 'back') => {
    setCaptureError(null);
    if (side === 'front') {
      releasePreview(frontImage);
      setFrontImage(null);
    } else {
      releasePreview(backImage);
      setBackImage(null);
    }
  };

  /**
   * Move to the diff, reading the card first when that is possible.
   *
   * The read is skipped — silently and without an error — when the feature is
   * off or when there is no front photo to read. Either way the form is seeded
   * from the outgoing card and the user edits by hand.
   */
  const goToReview = async (sides: CapturedCardSide[]) => {
    const front = sides.find((side) => side.role === 'card_front');

    if (!canExtract || !front) {
      setValues(toRenewalValues(currentValues, null));
      setEditedFields(new Set());
      setFieldErrors({});
      setStage('review');
      return;
    }

    setStage('processing');
    const result = await runExtraction(sides);
    setValues(toRenewalValues(currentValues, result));
    setEditedFields(new Set());
    setFieldErrors({});
    setStage('review');
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
              add is stored with the new version, and you type the new details
              yourself on the next step.
            </Alert>
          )}

          {stage === 'front' ? (
            <CardCaptureStep
              side="front"
              image={frontImage}
              isProcessing={isCropping}
              error={captureError}
              heading="Photograph the front of the new card (optional)"
              helpText={
                canExtract
                  ? 'The new photo replaces the front image on this card. The old version keeps its own. Skip it to type the details instead.'
                  : 'The new photo replaces the front image on this card. The old version keeps its own. Skip it if you are only updating the details.'
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
                releasePreview(frontImage);
                setFrontImage(null);
                setStage('back');
              }}
              onCancel={() => void handleCancel()}
            />
          ) : (
            <CardCaptureStep
              side="back"
              image={backImage}
              isProcessing={isCropping}
              error={captureError}
              heading="Photograph the back of the new card (optional)"
              helpText="The new photo replaces the back image on this card. The old version keeps its own."
              continueLabel={canExtract && frontImage ? 'Read the card' : 'Continue'}
              skipLabel="Skip the photo"
              onFileSelected={(file) => void handleFileSelected('back', file)}
              onRetake={() => handleRetake('back')}
              onContinue={() => void goToReview(capturedSides)}
              onSkip={() => {
                releasePreview(backImage);
                setBackImage(null);
                void goToReview(
                  frontImage ? [{ role: 'card_front', image: frontImage }] : [],
                );
              }}
              onCancel={() => void handleCancel()}
            />
          )}
        </>
      ) : stage === 'processing' ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <CircularProgress sx={{ mb: 2 }} />
          <Typography variant="h6" gutterBottom>
            Reading the new card…
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {isExtracting
              ? 'Your cropped photos have been sent to OpenAI. This usually takes a few seconds.'
              : 'Preparing the comparison…'}
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
                    onClick={() => void goToReview(capturedSides)}
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
              Enter the CVV / CVC from the new card to renew. It is never read
              from a photo and the old card's code is never reused, so you have
              to type it yourself.
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
