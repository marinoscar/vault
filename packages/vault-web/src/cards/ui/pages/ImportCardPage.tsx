import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
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
  Typography,
} from '@mui/material';
import { AutoAwesomeOutlined as AiIcon } from '@mui/icons-material';

import { AiEgressNotice } from '../components/AiEgressNotice.js';
import { CardCaptureStep } from '../components/CardCaptureStep.js';
import { CardCropReview, type CardSideCrop } from '../components/CardCropReview.js';
import { CardFlowStepper, type CardFlowStep } from '../components/CardFlowStepper.js';
import { CardReviewForm } from '../components/CardReviewForm.js';
import { useAiStatus } from '../../../core/headless/useAiStatus.js';
import {
  AI_SETTINGS_PATH,
  LOW_CONFIDENCE_THRESHOLD,
  aiSeededFields,
  buildDefaultCardName,
  toReviewValues,
  useCardImport,
  type CapturedCardPhoto,
  type CapturedCardSide,
} from '../../headless/useCardImport.js';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';
import type { CardCropBox } from '../../../core/headless/types.js';
import {
  cropImageFileToBox,
  cropImageFileToCard,
  prepareCardPhoto,
  type CardAdjustments,
  type CroppedCardImage,
} from '../../headless/cardImage.js';

type Stage = 'front' | 'back' | 'processing' | 'crop' | 'review';

/** Where each stage sits on the Capture → Crop → Review → Save stepper. */
const STAGE_STEP: Record<Stage, CardFlowStep> = {
  front: 'capture',
  back: 'capture',
  processing: 'crop',
  crop: 'crop',
  review: 'review',
};

/**
 * AI-assisted card import.
 *
 * Capture (front, then the optional back) -> Crop (the AI reads the card and
 * locates it; the user checks the crop) -> Review (AI-read fields marked, CVV
 * typed by hand) -> Save. The stepper shows those four steps (E10.5, #96).
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
 *     required — and the CVV is only ever typed by hand: it is never seeded
 *     from the extraction (`toReviewValues`), whatever the provider returned.
 *  2. A failed extraction is not a dead end. Any failure still lands on the
 *     review step with the captured photos and an empty form, so the card can
 *     be entered manually instead of starting over.
 */
export default function ImportCardPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const {
    config: aiConfig,
    cardExtractEnabled,
    canUseAi,
    isLoading: isStatusLoading,
  } = useAiStatus();
  const canOpenAiSettings = hasPermission('ai_config:read');
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
    // The Crop step only exists when there is a photo to crop.
    setStage(nextFront || nextBack ? 'crop' : 'review');
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

  // Fields whose value the AI supplied and the user has not touched since.
  const aiFields = useMemo(() => {
    const seeded = aiSeededFields(extraction);
    for (const field of editedFields) seeded.delete(field);
    return seeded;
  }, [extraction, editedFields]);

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
    // Three reasons, three messages: the viewer may not use AI (no `ai:use`, a
    // Viewer), AI is switched off, or it is on but card scanning is not set up.
    // There is deliberately no API key input anywhere on this page for any role:
    // the key is set on the Console's AI page, behind `ai_config:write`, and
    // nowhere else. Only a viewer who can open that page is offered the link.
    const reason: 'forbidden' | 'off' | 'not_set_up' = !canUseAi
      ? 'forbidden'
      : aiConfig.enabled === true
        ? 'not_set_up'
        : 'off';
    const text = {
      forbidden: {
        title: 'Card scanning is not available to you',
        detail: 'Your role does not include AI features. You can still add a card by typing its details.',
      },
      off: {
        title: 'AI is off',
        detail: 'AI is off — an admin can turn it on in Console → AI.',
      },
      not_set_up: {
        title: 'AI is not set up yet',
        detail:
          'AI is not set up yet — an administrator needs to add the OpenAI key and choose the card scanning model in Console → AI.',
      },
    }[reason];
    return (
      <Container maxWidth="md" disableGutters>
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
          <Typography sx={{
            color: "text.primary"
          }}>Import</Typography>
        </Breadcrumbs>

        <Alert severity="info">
          <AlertTitle>{text.title}</AlertTitle>
          {text.detail}
          <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {canOpenAiSettings && reason !== 'forbidden' && (
              <Button variant="contained" onClick={() => navigate(AI_SETTINGS_PATH)}>
                Open Console → AI
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

  const photoSides = [
    ...(frontPhoto ? [{ side: 'front' as const, file: frontPhoto.file, crop: frontCrop }] : []),
    ...(backPhoto ? [{ side: 'back' as const, file: backPhoto.file, crop: backCrop }] : []),
  ];

  const activeStep: CardFlowStep = isSaving || savedNotice ? 'save' : STAGE_STEP[stage];
  const readCount = aiSeededFields(extraction).size;

  return (
    <Container maxWidth="md" disableGutters>
      <Breadcrumbs sx={{ mb: 1 }}>
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
        <Typography sx={{ color: 'text.primary' }}>Scan a card</Typography>
      </Breadcrumbs>

      <Typography variant="h4" component="h1" sx={{ fontSize: { xs: '1.75rem', sm: '2.125rem' } }}>
        Scan a card
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
      ) : stage === 'front' || stage === 'back' ? (
        <>
          {/* Above the camera button, on both photos: the user reads where the
              photo goes before anything is taken, let alone sent. */}
          <AiEgressNotice />
          {stage === 'front' ? (
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
          ) : (
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
          )}
        </>
      ) : stage === 'processing' ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }} aria-live="polite">
          <CircularProgress sx={{ mb: 2 }} />
          <Typography variant="h6" component="h2" gutterBottom>
            Reading the card…
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {isExtracting
              ? 'Your photos have been sent to OpenAI, which locates the card and reads the printed details. This usually takes a few seconds.'
              : 'Cropping the photos to the card…'}
          </Typography>
        </Paper>
      ) : stage === 'crop' ? (
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
          <Typography variant="h6" component="h2" gutterBottom>
            Check the crop
          </Typography>
          {extractionError || extraction?.partial ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              The details could not be read automatically. You can type them in
              on the next step; your photos are kept.
            </Alert>
          ) : readCount > 0 ? (
            <Box
              sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, color: 'text.secondary' }}
            >
              <AiIcon fontSize="small" sx={{ color: 'primary.main' }} />
              <Typography variant="body2">
                {readCount} detail{readCount === 1 ? '' : 's'} read from the photo. You
                will check them on the next step.
              </Typography>
            </Box>
          ) : null}

          <CardCropReview sides={photoSides} onCropChange={handleCropChange} />

          <Box
            sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1 }}
          >
            <Button
              variant="contained"
              onClick={() => setStage('review')}
              sx={{ minHeight: 44 }}
            >
              Continue to details
            </Button>
            <Button
              variant="outlined"
              onClick={() => setStage('front')}
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
              {extractionError.adminLink && canOpenAiSettings && (
                <Box sx={{ mt: 1 }}>
                  <Link component={RouterLink} to={extractionError.adminLink.to}>
                    {extractionError.adminLink.label}
                  </Link>
                </Box>
              )}
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
            compact
            sides={photoSides}
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
                Fields marked <strong>AI</strong> were read from your photo; fields
                marked <strong>Check</strong> were hard to read. Compare them with the
                card. The CVV is never read from the photo — type it yourself.
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
              aiFields={aiFields}
              warnings={extraction?.warnings ?? []}
              errors={fieldErrors}
              disabled={isSaving}
            />
          )}

          {!cvvEntered && (
            <Alert severity="info" sx={{ mt: 2 }}>
              Enter the CVV / CVC to save this card. It is never read from the
              photo, so type it from the card yourself.
            </Alert>
          )}

          <Box
            sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1, mt: 3 }}
          >
            <Button
              variant="contained"
              onClick={() => void handleSave()}
              disabled={isSaving || !cvvEntered || !cardType}
              sx={{ minHeight: 44 }}
            >
              {isSaving ? 'Saving…' : 'Save card'}
            </Button>
            <Box sx={{ flexGrow: 1, display: { xs: 'none', sm: 'block' } }} />
            <Button
              color="inherit"
              onClick={() => void handleCancel()}
              disabled={isSaving}
              sx={{ minHeight: 44 }}
            >
              Cancel
            </Button>
          </Box>
        </Paper>
      )}
    </Container>
  );
}
