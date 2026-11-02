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
  PhotoLibraryOutlined as LibraryIcon,
  Refresh as RetakeIcon,
} from '@mui/icons-material';

import { CARD_ASPECT_RATIO } from '../../headless/cardImage.js';

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
 * Camera-friendly (E10.5): the primary action is a file input with
 * `capture="environment"`, which asks a phone for the rear camera and opens it
 * directly; on a desktop browser the same input degrades to an ordinary file
 * picker, which is why this is a file input rather than a getUserMedia preview.
 * A second, secondary action picks an existing photo from the library (no
 * `capture`), for a card photographed earlier. On a phone both buttons are full
 * width, comfortably above the 44px target size.
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
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const copy = COPY[side];

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so retaking with the same file name still fires a change event.
    event.target.value = '';
    if (file) onFileSelected(file);
  };

  const fullWidthOnPhone = { width: { xs: '100%', sm: 'auto' }, minHeight: 44 } as const;

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="h6" component="h2" gutterBottom>
        {heading ?? copy.heading}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          color: "text.secondary",
          mb: 2
        }}>
        {helpText ?? copy.help}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleChange}
        style={{ display: 'none' }}
        data-testid={`card-${side}-input`}
        aria-label={copy.action}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        onChange={handleChange}
        style={{ display: 'none' }}
        data-testid={`card-${side}-library-input`}
        aria-label={`Choose a photo of the ${side}`}
      />

      {photo ? (
        <Box
          sx={{
            mb: 2,
            mx: { xs: 'auto', sm: 0 },
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
            sx={{ display: 'block', width: '100%', height: 'auto', maxHeight: 360, objectFit: 'contain' }}
          />
        </Box>
      ) : (
        // A card-shaped frame with corner guides: what "every corner in the
        // shot" looks like. Decorative; the buttons below carry the action.
        <Box
          aria-hidden="true"
          sx={{
            position: 'relative',
            mb: 2,
            mx: { xs: 'auto', sm: 0 },
            maxWidth: 480,
            aspectRatio: String(CARD_ASPECT_RATIO),
            border: 1,
            borderStyle: 'dashed',
            borderColor: 'divider',
            borderRadius: 2,
            bgcolor: 'action.hover',
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            alignItems: 'center',
            justifyContent: 'center',
            color: 'text.secondary',
            '& .corner': {
              position: 'absolute',
              width: 28,
              height: 28,
              borderColor: 'primary.main',
              borderStyle: 'solid',
              borderWidth: 0,
            },
          }}
        >
          <Box className="corner" sx={{ top: 10, left: 10, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 }} />
          <Box className="corner" sx={{ top: 10, right: 10, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 }} />
          <Box className="corner" sx={{ bottom: 10, left: 10, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 8 }} />
          <Box className="corner" sx={{ bottom: 10, right: 10, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 8 }} />
          {isProcessing ? (
            <CircularProgress size={28} />
          ) : (
            <>
              <CameraIcon sx={{ fontSize: 36, color: 'text.disabled' }} />
              <Typography variant="body2">
                {side === 'front' ? 'Front of the card' : 'Back of the card'}
              </Typography>
            </>
          )}
        </Box>
      )}

      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          flexWrap: 'wrap',
          gap: 1,
        }}
      >
        {photo ? (
          <>
            <Button
              variant="contained"
              onClick={onContinue}
              disabled={isProcessing}
              sx={fullWidthOnPhone}
            >
              {continueLabel ?? (side === 'front' ? 'Continue' : 'Read the card')}
            </Button>
            <Button
              variant="outlined"
              startIcon={<RetakeIcon />}
              onClick={() => {
                onRetake();
                cameraRef.current?.click();
              }}
              disabled={isProcessing}
              sx={fullWidthOnPhone}
            >
              Retake
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="contained"
              startIcon={<CameraIcon />}
              onClick={() => cameraRef.current?.click()}
              disabled={isProcessing}
              sx={fullWidthOnPhone}
            >
              {copy.action}
            </Button>
            <Button
              variant="outlined"
              startIcon={<LibraryIcon />}
              onClick={() => libraryRef.current?.click()}
              disabled={isProcessing}
              sx={fullWidthOnPhone}
            >
              Choose a photo
            </Button>
          </>
        )}

        {onSkip && (
          <Button onClick={onSkip} disabled={isProcessing} sx={fullWidthOnPhone}>
            {skipLabel}
          </Button>
        )}

        <Box sx={{ flexGrow: 1, display: { xs: 'none', sm: 'block' } }} />

        <Button color="inherit" onClick={onCancel} disabled={isProcessing} sx={fullWidthOnPhone}>
          Cancel
        </Button>
      </Box>
    </Paper>
  );
}
