import { useRef, type ChangeEvent } from 'react';
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

import { CARD_ASPECT_RATIO } from '../../utils/cardImage';

interface CardCaptureStepProps {
  side: 'front' | 'back';
  /**
   * The captured photo, set by the caller once the pick has been prepared.
   * Only the preview matters here; the caller owns the file and the object
   * URL's lifetime.
   */
  photo: { previewUrl: string } | null;
  /** Called with the raw file the user picked; the caller prepares it. */
  onFileSelected: (file: File) => void;
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
    help: 'Make sure every corner of the card is in the shot and the text is readable.',
    action: 'Take a photo of the front',
  },
  back: {
    heading: 'Photograph the back of the card (optional)',
    help: 'Make sure every corner of the card is in the shot and the text is readable. Skip it if you would rather not photograph the signature strip.',
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
 * No cropping happens here: the FULL photo is shown as-is for a use-it-or-
 * retake decision, and the full frame is what the extraction endpoint receives
 * — the AI locates the card and returns its bounding box. Cropping to the card
 * (for the stored attachment) happens after extraction, seeded from that box
 * and adjustable on the review step; the full photo itself is never uploaded
 * to storage.
 */
export function CardCaptureStep({
  side,
  photo,
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

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so retaking with the same file name still fires a change event.
    event.target.value = '';
    if (file) onFileSelected(file);
  };

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

      {photo ? (
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
            src={photo.previewUrl}
            alt={`Photo of the ${side} of the card`}
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
        {photo ? (
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
        )}

        {onSkip && (
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
