import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';

import { AiEgressNotice } from '../components/cards/AiEgressNotice';
import { CardCaptureStep } from '../components/cards/CardCaptureStep';
import { CardCropReview, type CardSideCrop } from '../components/cards/CardCropReview';
import { CardReviewForm } from '../components/cards/CardReviewForm';
import { useAiStatus } from '../hooks/useAiStatus';
import {
  LOW_CONFIDENCE_THRESHOLD,
  buildDefaultCardName,
  toReviewValues,
  useCardImport,
  type CapturedCardPhoto,
  type CapturedCardSide,
} from '../hooks/useCardImport';
import { usePermissions } from '../hooks/usePermissions';
import type { CardCropBox } from '../types';
import {
  cropImageFileToBox,
  cropImageFileToCard,
  prepareCardPhoto,
  type CardAdjustments,
  type CroppedCardImage,
} from '../utils/cardImage';

type Stage = 'front' | 'back' | 'processing' | 'review';

const STEP_LABELS = ['Front', 'Back', 'Read', 'Review'];
const STEP_INDEX: Record<Stage, number> = {
  front: 0,
  back: 1,
  processing: 2,
  review: 3,
};

/**
 * AI-assisted card import.
 *
 * Front capture -> back capture (skippable) -> extraction -> review -> save.
 *
 * The capture steps collect FULL photos — no cropping happens there. The
 * prepared full frames go to the extraction endpoint, which locates the card
 * and returns a bounding box per side; the stored attachment is then cropped
 * from that box (or the centred auto-fit when no box came back) and can be
 * adjusted manually on the review step. Only the cropped version is ever
 * uploaded to storage — the full photo goes to the AI and nowhere else.
 *
 * Two invariants shape the whole flow:
 *
 *  1. A card cannot be saved without a CVV — the Card secret type marks it
 *     required. The extraction usually supplies one now, but the gate stays on
 *     the VALUE rather than on where it came from, so a card the model could
 *     not read the code off still cannot be saved half-finished.
 *  2. A failed extraction is not a dead end. Any failure still lands on the
 *     review step with the captured photos and an empty form, so the card can
 *     be entered manually instead of starting over.
 */
export default function ImportCardPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const {
    cardExtractEnabled,
    isLoading: isStatusLoading,
  } = useAiStatus();
  const {
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
  } = useCardImport();

  const [stage, setStage] = useState<Stage>('front');
  const [frontPhoto, setFrontPhoto] = useState<CapturedCardPhoto | null>(null);
  const [backPhoto, setBackPhoto] = useState<CapturedCardPhoto | null>(null);
  const [frontCrop, setFrontCrop] = useState<CardSideCrop | null>(null);
  const [backCrop, setBackCrop] = useState<CardSideCrop | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [values, setValues] = useState<Record<string, string>>(() => toReviewValues(null));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [editedFields, setEditedFields] = useState<Set<string>>(new Set());
  const [savedNotice, setSavedNotice] = useState<
    { secretId: string; warning: string } | null
  >(null);

  // Object URLs (full-photo previews AND crop previews) are revoked
  // explicitly. They are held in a ref as well as state so the unmount cleanup
  // sees the current set rather than a stale closure, which is the difference
  // between releasing the blobs and leaking them for the life of the document.
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

  // What gets uploaded on save: the CROPPED images, never the full photos.
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
      // Full frame only: downscaled if huge, but never cropped or rotated —
      // the AI locates the card, and its box fractions apply to this image.
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
   * when one came back, otherwise the legacy centred auto-fit. A failed box
   * crop falls back to the auto-fit rather than losing the side.
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

  const goToReview = async (
    front: CapturedCardPhoto,
    back: CapturedCardPhoto | null,
  ) => {
    setStage('processing');
    const result = await runExtraction({
      front: front.prepared.dataUrl,
      back: back?.prepared.dataUrl,
    });

    const nextFront = await renderInitialCrop(
      'front',
      front,
      result?.crops?.front ?? null,
    );
    const nextBack = back
      ? await renderInitialCrop('back', back, result?.crops?.back ?? null)
      : null;
    releaseUrl(frontCrop?.image.previewUrl);
    releaseUrl(backCrop?.image.previewUrl);
    setFrontCrop(nextFront);
    setBackCrop(nextBack);

    const seeded = toReviewValues(result);
    setValues(seeded);
    setName(buildDefaultCardName(seeded.card_network, seeded.number));
    setEditedFields(new Set());
    setFieldErrors({});
    setStage('review');
  };

  /** The user re-cropped a side in the review step's adjuster. */
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
    await abandonImport();
    navigate('/cards');
  };

  const handleFieldChange = (field: string, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
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
    if (!extraction?.confidence) return flagged;
    for (const [field, score] of Object.entries(extraction.confidence)) {
      // A field the user has already corrected no longer needs checking, and an
      // empty field is covered by required-field validation instead.
      if (editedFields.has(field)) continue;
      if ((values[field] ?? '') === '') continue;
      if (score <= LOW_CONFIDENCE_THRESHOLD) flagged.add(field);
    }
    return flagged;
  }, [extraction, values, editedFields]);

  const cvvEntered = (values.cvv ?? '').trim() !== '';

  const handleSave = async () => {
    if (!cardType) return;

    const errors: Record<string, string> = {};
    if (!name.trim()) errors.__name = 'A name is required';
    for (const field of cardType.fields) {
      if (field.required && (values[field.name] ?? '').trim() === '') {
        errors[field.name] = `${field.label} is required`;
      }
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    const outcome = await saveCard({ name, values, images: capturedSides });
    if (!outcome) return;

    if (outcome.attachmentWarning) {
      // Do not swallow this by navigating away — the user chose to attach
      // photos and needs to know they are not there.
      setSavedNotice({ secretId: outcome.secretId, warning: outcome.attachmentWarning });
      return;
    }
    navigate(`/secrets/${outcome.secretId}`);
  };

  // ---------------------------------------------------------------------------
  // Gating
  // ---------------------------------------------------------------------------

  if (isStatusLoading) {
    return (
      <Container maxWidth="md" sx={{ py: 6, textAlign: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (!cardExtractEnabled) {
    // Non-admins get an explanation and nothing else. There is deliberately no
    // API key input anywhere on this page for any role — credentials are
    // entered in System Settings, behind the admin gate, and nowhere else.
    const canConfigure = hasPermission('system_settings:write');
    return (
      <Container maxWidth="md" sx={{ py: 3 }}>
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
          <Typography color="text.primary">Import</Typography>
        </Breadcrumbs>

        <Alert severity="info">
          <AlertTitle>Card scanning is not available</AlertTitle>
          {canConfigure
            ? 'AI card scanning is turned off, or no OpenAI API key is stored. Enable it and add a key under System Settings → AI.'
            : 'AI card scanning is turned off for this application. Ask an administrator to enable it if you need it.'}
          <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {canConfigure && (
              <Button variant="contained" onClick={() => navigate('/admin/settings')}>
                Open System Settings
              </Button>
            )}
            <Button variant="outlined" onClick={() => navigate('/secrets/new')}>
              Add a card manually
            </Button>
            <Button color="inherit" onClick={() => navigate('/cards')}>
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
        <Typography color="text.primary">Import a card</Typography>
      </Breadcrumbs>

      <Typography variant="h4" gutterBottom>
        Import a credit card
      </Typography>

      <Stepper activeStep={STEP_INDEX[stage]} sx={{ my: 3 }} alternativeLabel>
        {STEP_LABELS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {typeError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {typeError}
        </Alert>
      )}

      {savedNotice ? (
        <Paper sx={{ p: 3 }}>
          <Alert severity="warning" sx={{ mb: 2 }}>
            <AlertTitle>Card saved, photos not attached</AlertTitle>
            {savedNotice.warning}
          </Alert>
          <Button
            variant="contained"
            onClick={() => navigate(`/secrets/${savedNotice.secretId}`)}
          >
            View the card
          </Button>
        </Paper>
      ) : stage === 'front' ? (
        <>
          <AiEgressNotice />
          <CardCaptureStep
            side="front"
            photo={frontPhoto}
            isProcessing={isPreparing}
            error={captureError}
            onFileSelected={(file) => void handleFileSelected('front', file)}
            onRetake={() => handleRetake('front')}
            onContinue={() => setStage('back')}
            onCancel={() => void handleCancel()}
          />
        </>
      ) : stage === 'back' ? (
        <>
          <AiEgressNotice />
          <CardCaptureStep
            side="back"
            photo={backPhoto}
            isProcessing={isPreparing}
            error={captureError}
            onFileSelected={(file) => void handleFileSelected('back', file)}
            onRetake={() => handleRetake('back')}
            onContinue={() => {
              if (frontPhoto) void goToReview(frontPhoto, backPhoto);
            }}
            onSkip={() => {
              releaseUrl(backPhoto?.previewUrl);
              setBackPhoto(null);
              if (frontPhoto) void goToReview(frontPhoto, null);
            }}
            onCancel={() => void handleCancel()}
          />
        </>
      ) : stage === 'processing' ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <CircularProgress sx={{ mb: 2 }} />
          <Typography variant="h6" gutterBottom>
            Reading the card…
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
            Check the details
          </Typography>

          {extractionError && (
            <Alert
              severity={extractionError.adminActionRequired ? 'warning' : 'error'}
              sx={{ mb: 2 }}
              action={
                extractionError.retryable ? (
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => {
                      if (frontPhoto) void goToReview(frontPhoto, backPhoto);
                    }}
                  >
                    Try again
                  </Button>
                ) : undefined
              }
            >
              <AlertTitle>{extractionError.title}</AlertTitle>
              {extractionError.detail}
              <Typography variant="body2" sx={{ mt: 1 }}>
                Your photos were kept — fill the details in below and they will be
                attached to the card.
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

          <CardCropReview
            sides={[
              ...(frontPhoto
                ? [{ side: 'front' as const, file: frontPhoto.file, crop: frontCrop }]
                : []),
              ...(backPhoto
                ? [{ side: 'back' as const, file: backPhoto.file, crop: backCrop }]
                : []),
            ]}
            disabled={isSaving}
            onCropChange={handleCropChange}
          />

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
            helperText={fieldErrors.__name ?? 'Shown in your card list.'}
            disabled={isSaving}
            sx={{ mb: 2 }}
          />

          {isTypeLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : (
            <CardReviewForm
              fields={cardType?.fields ?? []}
              values={values}
              onChange={handleFieldChange}
              lowConfidenceFields={lowConfidenceFields}
              warnings={extraction?.warnings ?? []}
              errors={fieldErrors}
              disabled={isSaving}
            />
          )}

          {!cvvEntered && (
            <Alert severity="info" sx={{ mt: 2 }}>
              Enter the CVV / CVC to save this card. It could not be read from
              the photo, so type it from the card yourself.
            </Alert>
          )}

          <Box sx={{ display: 'flex', gap: 1, mt: 3, flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              onClick={() => void handleSave()}
              disabled={isSaving || !cvvEntered || !cardType}
            >
              {isSaving ? 'Saving…' : 'Save card'}
            </Button>
            <Box sx={{ flexGrow: 1 }} />
            <Button color="inherit" onClick={() => void handleCancel()} disabled={isSaving}>
              Cancel
            </Button>
          </Box>
        </Paper>
      )}
    </Container>
  );
}
