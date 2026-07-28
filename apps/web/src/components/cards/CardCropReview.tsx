import { useState } from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';
import { Crop as CropIcon } from '@mui/icons-material';

import type { CardCropBox } from '../../types';
import {
  CARD_ASPECT_RATIO,
  cropImageFileToCard,
  type CardAdjustments,
  type CroppedCardImage,
} from '../../utils/cardImage';
import { CardCropAdjuster } from './CardCropAdjuster';

/**
 * The state of one side's stored-attachment crop, owned by the page.
 *
 * `box` is the AI's location of the card (null when the extraction returned
 * none and the centred auto-fit was used); `adjustments` is the user's manual
 * override, once they have made one. Whichever exists seeds the adjuster, the
 * override taking precedence.
 */
export interface CardSideCrop {
  image: CroppedCardImage;
  box: CardCropBox | null;
  adjustments: CardAdjustments | null;
}

export interface CardCropReviewSide {
  side: 'front' | 'back';
  /** The raw full capture the crop is rendered from. Never uploaded itself. */
  file: File;
  /** Null when the initial render failed; the adjuster can still create one. */
  crop: CardSideCrop | null;
}

interface CardCropReviewProps {
  sides: CardCropReviewSide[];
  disabled?: boolean;
  /**
   * A new crop was confirmed in the adjuster and rendered. The caller replaces
   * its stored image (revoking the old preview URL) and remembers the
   * adjustments so reopening the adjuster resumes from them.
   */
  onCropChange: (
    side: 'front' | 'back',
    image: CroppedCardImage,
    adjustments: CardAdjustments,
  ) => void;
}

/**
 * Review-step gallery of the cropped card photos that will be stored, each
 * with an "Adjust crop" override.
 *
 * The initial crops come from the AI's bounding boxes (or the centred
 * auto-fit fallback); this component reopens {@link CardCropAdjuster} on the
 * raw capture, seeded from that box or from the user's last adjustment, and
 * re-renders the attachment file on confirm — so what is uploaded on save is
 * always exactly what is previewed here.
 */
export function CardCropReview({
  sides,
  disabled = false,
  onCropChange,
}: CardCropReviewProps) {
  const [adjustingSide, setAdjustingSide] = useState<'front' | 'back' | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  if (sides.length === 0) return null;

  const adjusting = sides.find((entry) => entry.side === adjustingSide) ?? null;

  const applyAdjustments = async (
    entry: CardCropReviewSide,
    adjustments: CardAdjustments,
  ) => {
    setIsRendering(true);
    setRenderError(null);
    try {
      const image = await cropImageFileToCard(entry.file, {
        fileName: `card-${entry.side}.jpg`,
        ...adjustments,
      });
      onCropChange(entry.side, image, adjustments);
      setAdjustingSide(null);
    } catch (err) {
      setRenderError(
        err instanceof Error ? err.message : 'That crop could not be applied.',
      );
    } finally {
      setIsRendering(false);
    }
  };

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="subtitle1" gutterBottom>
        Card photos
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        These crops are what gets saved with the card — the full photos are
        never stored. Adjust a crop if the card was not framed right.
      </Typography>

      {renderError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {renderError}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {sides.map((entry) => (
          <Box key={entry.side} sx={{ width: { xs: '100%', sm: 232 } }}>
            <Typography variant="caption" color="text.secondary">
              {entry.side === 'front' ? 'Front' : 'Back'}
            </Typography>
            {entry.crop ? (
              <Box
                sx={{
                  borderRadius: 1,
                  overflow: 'hidden',
                  border: 1,
                  borderColor: 'divider',
                }}
              >
                <Box
                  component="img"
                  src={entry.crop.image.previewUrl}
                  alt={`Cropped ${entry.side} of the card`}
                  sx={{ display: 'block', width: '100%', height: 'auto' }}
                />
              </Box>
            ) : (
              <Box
                sx={{
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
                <Typography variant="body2">No crop yet</Typography>
              </Box>
            )}
            <Button
              size="small"
              startIcon={<CropIcon />}
              onClick={() => {
                setRenderError(null);
                setAdjustingSide(entry.side);
              }}
              disabled={disabled || isRendering}
              sx={{ mt: 0.5 }}
            >
              Adjust crop
            </Button>
          </Box>
        ))}
      </Box>

      {adjusting && (
        <Box sx={{ mt: 2 }}>
          <CardCropAdjuster
            file={adjusting.file}
            side={adjusting.side}
            isProcessing={isRendering}
            initialAdjustments={adjusting.crop?.adjustments ?? undefined}
            initialBox={adjusting.crop?.box ?? undefined}
            confirmLabel="Apply crop"
            retakeLabel="Cancel"
            onConfirm={(adjustments) => void applyAdjustments(adjusting, adjustments)}
            onRetake={() => setAdjustingSide(null)}
          />
        </Box>
      )}
    </Box>
  );
}
