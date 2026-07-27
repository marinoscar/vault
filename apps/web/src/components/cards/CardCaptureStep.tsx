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

import { CARD_ASPECT_RATIO, type CroppedCardImage } from '../../utils/cardImage';

interface CardCaptureStepProps {
  side: 'front' | 'back';
  image: CroppedCardImage | null;
  /** Called with the raw file; the caller crops it. */
  onFileSelected: (file: File) => void;
  onRetake: () => void;
  onContinue: () => void;
  /** Present only on the back step, where the shot is optional. */
  onSkip?: () => void;
  onCancel: () => void;
  isProcessing?: boolean;
  error?: string | null;
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
        {copy.heading}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {copy.help}
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

      {image ? (
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
        {image ? (
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
              {side === 'front' ? 'Continue' : 'Read the card'}
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
            Skip the back
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
