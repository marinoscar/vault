import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Typography,
} from '@mui/material';
import {
  PhotoCamera as CameraIcon,
  Refresh as RetakeIcon,
} from '@mui/icons-material';

import {
  CARD_ASPECT_RATIO,
  type CardAdjustments,
  type CroppedCardImage,
} from '../../utils/cardImage';
import { CardCropAdjuster } from './CardCropAdjuster';

interface CardCaptureStepProps {
  side: 'front' | 'back';
  image: CroppedCardImage | null;
  /**
   * Called with the raw file and the framing the user confirmed in the adjust
   * stage; the caller crops it.
   */
  onFileSelected: (file: File, adjustments: CardAdjustments) => void;
  onRetake: () => void;
  onContinue: () => void;
  /** Present only on the back step, where the shot is optional. */
  onSkip?: () => void;
  onCancel: () => void;
  isProcessing?: boolean;
  error?: string | null;
  /**
   * Overrides for the copy, used by the renewal flow.
   *
   * The defaults below are written for a first-time import ("Photograph the
   * front of the card"), which is subtly wrong when the user is replacing a
   * card they already hold and the photo is optional. Each is opt-in so the
   * import wizard's wording is untouched.
   */
  heading?: string;
  helpText?: string;
  /**
   * Label for the primary button once a photo is present. Defaults to
   * 'Continue' on the front and 'Read the card' on the back — the latter being
   * a promise only the AI-assisted flow can keep, which is why a manual
   * renewal overrides it.
   */
  continueLabel?: string;
  /** Label for the skip button. Defaults to 'Skip the back'. */
  skipLabel?: string;
}


const COPY = {
  front: {
    heading: 'Photograph the front of the card',
    help: 'Lay the card on a flat, plain surface in good light and fill the frame. The photo is cropped to the card automatically.',
    action: 'Take a photo of the front',
  },
  back: {
    heading: 'Photograph the back of the card (optional)',
    help: 'The back often carries the issuing bank. Skip it if you would rather not photograph the signature strip.',
    action: 'Take a photo of the back',
  },
} as const;

/**
 * One capture step of the import wizard.
 *
 * `capture="environment"` asks a phone for the rear camera and opens the camera
 * directly; on a desktop browser the same input degrades to an ordinary file
 * picker, which is why this is a file input rather than a getUserMedia preview.
 *
 * Picking a photo no longer crops it immediately: the raw file first goes
 * through an adjust stage ({@link CardCropAdjuster}) where the user zooms,
 * pans and rotates until the card fills the frame, and only their confirmed
 * framing is handed to `onFileSelected`. The raw frame still never leaves the
 * device — the adjuster draws locally and the caller crops before uploading.
 */
export function CardCaptureStep({
  side,
  image,
  onFileSelected,
  onRetake,
  onContinue,
  onSkip,
  onCancel,
  isProcessing = false,
  error = null,
  heading,
  helpText,
  continueLabel,
  skipLabel = 'Skip the back',
}: CardCaptureStepProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const copy = COPY[side];

  // The picked-but-not-yet-confirmed capture being framed in the adjuster.
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  // The caller reports a successful crop by setting `image`; that is the
  // signal the adjust stage is over. On a failed crop `image` stays null and
  // the adjuster remains up with the error above it, so the user can re-frame
  // or retake instead of losing the shot.
  useEffect(() => {
    if (image) setPendingFile(null);
  }, [image]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so retaking with the same file name still fires a change event.
    event.target.value = '';
    if (file) setPendingFile(file);
  };

  const isAdjusting = pendingFile !== null && !image;

  return (
    <Paper sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="h6" gutterBottom>
        {heading ?? copy.heading}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {helpText ?? copy.help}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleChange}
        style={{ display: 'none' }}
        data-testid={`card-${side}-input`}
        aria-label={copy.action}
      />

      {isAdjusting && pendingFile ? (
        <CardCropAdjuster
          file={pendingFile}
          side={side}
          isProcessing={isProcessing}
          onConfirm={(adjustments) => onFileSelected(pendingFile, adjustments)}
          onRetake={() => {
            setPendingFile(null);
            inputRef.current?.click();
          }}
        />
      ) : image ? (
        <Box
          sx={{
            mb: 2,
            borderRadius: 1,
            overflow: 'hidden',
            border: 1,
            borderColor: 'divider',
            maxWidth: 480,
          }}
        >
          <Box
            component="img"
            src={image.previewUrl}
            alt={`Cropped ${side} of the card`}
            sx={{ display: 'block', width: '100%', height: 'auto' }}
          />
        </Box>
      ) : (
        <Box
          sx={{
            mb: 2,
            maxWidth: 480,
            aspectRatio: String(CARD_ASPECT_RATIO),
            border: 1,
            borderStyle: 'dashed',
            borderColor: 'divider',
            borderRadius: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'text.disabled',
          }}
        >
          {isProcessing ? (
            <CircularProgress size={28} />
          ) : (
            <Typography variant="body2">No photo yet</Typography>
          )}
        </Box>
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {/* While adjusting, the primary actions (Use this photo / Retake) live
            inside the adjuster; only Skip and Cancel remain down here. */}
        {!isAdjusting &&
          (image ? (
            <>
              <Button
                variant="outlined"
                startIcon={<RetakeIcon />}
                onClick={() => {
                  onRetake();
                  inputRef.current?.click();
                }}
                disabled={isProcessing}
              >
                Retake
              </Button>
              <Button variant="contained" onClick={onContinue} disabled={isProcessing}>
                {continueLabel ?? (side === 'front' ? 'Continue' : 'Read the card')}
              </Button>
            </>
          ) : (
            <Button
              variant="contained"
              startIcon={<CameraIcon />}
              onClick={() => inputRef.current?.click()}
              disabled={isProcessing}
            >
              {copy.action}
            </Button>
          ))}

        {onSkip && !isAdjusting && (
          <Button onClick={onSkip} disabled={isProcessing}>
            {skipLabel}
          </Button>
        )}

        <Box sx={{ flexGrow: 1 }} />

        <Button color="inherit" onClick={onCancel} disabled={isProcessing}>
          Cancel
        </Button>
      </Box>
    </Paper>
  );
}
