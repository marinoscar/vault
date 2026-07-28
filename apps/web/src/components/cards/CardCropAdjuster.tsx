import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Alert, Box, Button, CircularProgress, Slider, Stack } from '@mui/material';
import {
  Check as ConfirmIcon,
  Refresh as RetakeIcon,
  RotateRight as RotateIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
} from '@mui/icons-material';

import {
  CARD_ASPECT_RATIO,
  CARD_IMAGE_MAX_ZOOM,
  adjustmentsFromCropBox,
  clamp,
  computeAdjustedCropRect,
  computeMaxPan,
  drawCardCrop,
  effectiveSourceSize,
  normalizeQuarterTurns,
  type CardAdjustments,
  type FractionalCropBox,
} from '../../utils/cardImage';

/** The adjustments as the adjuster holds them: every knob resolved. */
type ResolvedAdjustments = Required<CardAdjustments>;

const INITIAL_ADJUSTMENTS: ResolvedAdjustments = {
  zoom: 1,
  panX: 0,
  panY: 0,
  quarterTurns: 0,
};

/**
 * Preview canvas backing resolution. Wider than the on-screen size (~480 CSS
 * px capped by the layout) so the preview stays sharp on high-DPI phones —
 * which is where this flow mostly runs.
 */
const PREVIEW_WIDTH = 960;
const PREVIEW_HEIGHT = Math.round(PREVIEW_WIDTH / CARD_ASPECT_RATIO);

interface CardCropAdjusterProps {
  /** The raw capture, exactly as picked. Never uploaded — only drawn locally. */
  file: File;
  side: 'front' | 'back';
  /** Fired with the final adjustments when the user accepts the framing. */
  onConfirm: (adjustments: CardAdjustments) => void;
  /** The user backed out; the caller reopens the picker (or closes the stage). */
  onRetake: () => void;
  /** True while the caller is encoding the confirmed crop. */
  isProcessing?: boolean;
  /**
   * Seed the knobs from a previously confirmed adjustment, so reopening the
   * adjuster resumes where the user left off. Takes precedence over
   * `initialBox`.
   */
  initialAdjustments?: CardAdjustments;
  /**
   * Seed the knobs from the AI-returned fractional box, so the adjuster opens
   * showing the crop the box produced rather than the centred auto-fit. Used
   * when the user has not adjusted this side yet.
   */
  initialBox?: FractionalCropBox;
  /** Label of the confirm button. Defaults to 'Use this photo'. */
  confirmLabel?: string;
  /** Label of the secondary (back-out) button. Defaults to 'Retake'. */
  retakeLabel?: string;
}

/**
 * Interactive crop override.
 *
 * The AI locates the card and its box seeds the stored-attachment crop; this
 * stage exists for when that box (or, with AI unavailable, the centred
 * auto-fit) is wrong. The user rotates (90° steps), zooms (1-4x) and drags the
 * picture until the card fills the card-shaped viewport, then confirms. The
 * preview is drawn by the SAME `drawCardCrop` routine that later encodes the
 * stored crop, so what the user approves is what gets kept.
 *
 * The raw file is only ever drawn to a local canvas here; only the confirmed
 * crop, encoded by the caller, is uploaded to storage.
 */
export function CardCropAdjuster({
  file,
  side,
  onConfirm,
  onRetake,
  isProcessing = false,
  initialAdjustments,
  initialBox,
  confirmLabel = 'Use this photo',
  retakeLabel = 'Retake',
}: CardCropAdjusterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adjust, setAdjust] = useState<ResolvedAdjustments>(INITIAL_ADJUSTMENTS);

  // The seeds are read once per decoded file, inside the decode effect. A ref
  // keeps them out of that effect's dependencies: pages pass fresh object
  // literals every render, and re-running the decode on each would reset the
  // user's in-progress adjustment.
  const seedRef = useRef({ initialAdjustments, initialBox });
  seedRef.current = { initialAdjustments, initialBox };

  /** Resolve the starting knobs for a freshly decoded image. */
  const resolveSeed = (element: HTMLImageElement): ResolvedAdjustments => {
    const { initialAdjustments: seedAdjust, initialBox: seedBox } = seedRef.current;
    if (seedAdjust) {
      return {
        zoom: clamp(seedAdjust.zoom ?? 1, 1, CARD_IMAGE_MAX_ZOOM),
        panX: seedAdjust.panX ?? 0,
        panY: seedAdjust.panY ?? 0,
        quarterTurns: normalizeQuarterTurns(seedAdjust.quarterTurns),
      };
    }
    if (seedBox) {
      try {
        return adjustmentsFromCropBox(
          element.naturalWidth || element.width,
          element.naturalHeight || element.height,
          seedBox,
        );
      } catch {
        // A degenerate box seeds nothing; fall through to the auto-fit start.
      }
    }
    return INITIAL_ADJUSTMENTS;
  };

  // One active drag at a time; a second touch while dragging is ignored rather
  // than making the pan jump between fingers.
  const dragRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(
    null,
  );
  const [isDragging, setIsDragging] = useState(false);

  // Decode the picked file once per file. The object URL is revoked as soon as
  // the decode settles — the decoded element keeps its pixels without it.
  useEffect(() => {
    let cancelled = false;
    setImage(null);
    setLoadError(null);
    setAdjust(INITIAL_ADJUSTMENTS);

    const url = URL.createObjectURL(file);
    const element = new Image();
    element.onload = () => {
      URL.revokeObjectURL(url);
      if (!cancelled) {
        setImage(element);
        setAdjust(resolveSeed(element));
      }
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      if (!cancelled) setLoadError('That file could not be read as an image.');
    };
    element.src = url;

    return () => {
      cancelled = true;
    };
  }, [file]);

  // Redraw on every knob change, coalesced to one draw per frame: the cleanup
  // cancels a not-yet-painted frame when a newer state lands, which is all the
  // debounce a drag needs.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;

    const frame = requestAnimationFrame(() => {
      const context = canvas.getContext('2d');
      if (!context) return;
      const sourceWidth = image.naturalWidth || image.width;
      const sourceHeight = image.naturalHeight || image.height;
      const effective = effectiveSourceSize(
        sourceWidth,
        sourceHeight,
        adjust.quarterTurns,
      );
      const crop = computeAdjustedCropRect(
        effective.width,
        effective.height,
        adjust.zoom,
        adjust.panX,
        adjust.panY,
      );
      drawCardCrop(
        context,
        image,
        sourceWidth,
        sourceHeight,
        { crop, quarterTurns: adjust.quarterTurns },
        canvas.width,
        canvas.height,
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [image, adjust]);

  /** Clamp a pan against the slack available at the given zoom/rotation. */
  const clampPan = useCallback(
    (panX: number, panY: number, zoom: number, quarterTurns: number) => {
      if (!image) return { panX, panY };
      const sourceWidth = image.naturalWidth || image.width;
      const sourceHeight = image.naturalHeight || image.height;
      const effective = effectiveSourceSize(sourceWidth, sourceHeight, quarterTurns);
      const max = computeMaxPan(effective.width, effective.height, zoom);
      return {
        panX: clamp(panX, -max.x, max.x),
        panY: clamp(panY, -max.y, max.y),
      };
    },
    [image],
  );

  const handleRotate = () => {
    // A rotation changes which way the pan axes point; recentering is less
    // surprising than a pan that suddenly moves the picture sideways.
    setAdjust((prev) => ({
      zoom: prev.zoom,
      panX: 0,
      panY: 0,
      quarterTurns: (prev.quarterTurns + 1) % 4,
    }));
  };

  const handleZoom = (value: number) => {
    setAdjust((prev) => {
      const zoom = clamp(value, 1, CARD_IMAGE_MAX_ZOOM);
      // Zooming out shrinks the available slack; pull the pan back in so the
      // crop never sticks outside the frame.
      const panned = clampPan(prev.panX, prev.panY, zoom, prev.quarterTurns);
      return { ...prev, zoom, ...panned };
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (isProcessing || !image || dragRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !image) return;

    const deltaX = event.clientX - drag.lastX;
    const deltaY = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;

    const viewWidth = event.currentTarget.getBoundingClientRect().width;
    if (viewWidth <= 0) return;

    setAdjust((prev) => {
      const sourceWidth = image.naturalWidth || image.width;
      const sourceHeight = image.naturalHeight || image.height;
      const effective = effectiveSourceSize(
        sourceWidth,
        sourceHeight,
        prev.quarterTurns,
      );
      const crop = computeAdjustedCropRect(
        effective.width,
        effective.height,
        prev.zoom,
        prev.panX,
        prev.panY,
      );
      // Dragging moves the PICTURE under a fixed viewport, so the crop rect
      // moves the opposite way, scaled from CSS pixels to source pixels.
      const scale = crop.width / viewWidth;
      const panned = clampPan(
        prev.panX - deltaX * scale,
        prev.panY - deltaY * scale,
        prev.zoom,
        prev.quarterTurns,
      );
      return { ...prev, ...panned };
    });
  };

  const endDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsDragging(false);
  };

  return (
    <Box>
      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {loadError}
        </Alert>
      )}

      <Box
        sx={{
          mb: 1.5,
          maxWidth: 480,
          borderRadius: 1,
          overflow: 'hidden',
          border: 1,
          borderColor: 'divider',
          position: 'relative',
          bgcolor: 'action.hover',
        }}
      >
        {/* A raw <canvas>, not <Box component="canvas">: MUI would consume
            `width`/`height` as CSS system props instead of setting the
            canvas's backing-store resolution. */}
        <canvas
          ref={canvasRef}
          width={PREVIEW_WIDTH}
          height={PREVIEW_HEIGHT}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          aria-label={`Adjust the crop of the ${side} photo`}
          data-testid={`card-${side}-adjuster`}
          style={{
            display: 'block',
            width: '100%',
            height: 'auto',
            aspectRatio: String(CARD_ASPECT_RATIO),
            // Without this, a touch drag scrolls the page instead of panning.
            touchAction: 'none',
            cursor: isDragging ? 'grabbing' : 'grab',
          }}
        />
        {!image && !loadError && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <CircularProgress size={28} />
          </Box>
        )}
      </Box>

      <Box sx={{ maxWidth: 480 }}>
        <Box
          sx={{ mb: 1.5, typography: 'body2', color: 'text.secondary' }}
        >
          Zoom and drag until the card fills the frame — this crop is what gets
          stored with the card. Rotate if the card is on its side or upside
          down.
        </Box>

        <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
          <ZoomOutIcon fontSize="small" color="action" />
          <Slider
            value={adjust.zoom}
            min={1}
            max={CARD_IMAGE_MAX_ZOOM}
            step={0.05}
            onChange={(_event, value) => {
              if (typeof value === 'number') handleZoom(value);
            }}
            disabled={isProcessing || !image}
            aria-label="Zoom"
            valueLabelDisplay="auto"
            valueLabelFormat={(value) => `${value.toFixed(1)}x`}
          />
          <ZoomInIcon fontSize="small" color="action" />
          <Button
            startIcon={<RotateIcon />}
            onClick={handleRotate}
            disabled={isProcessing || !image}
            sx={{ flexShrink: 0 }}
          >
            Rotate
          </Button>
        </Stack>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <Button
            variant="contained"
            startIcon={
              isProcessing ? <CircularProgress size={16} color="inherit" /> : <ConfirmIcon />
            }
            onClick={() => onConfirm(adjust)}
            disabled={isProcessing || !image}
          >
            {isProcessing ? 'Cropping…' : confirmLabel}
          </Button>
          <Button
            variant="outlined"
            startIcon={<RetakeIcon />}
            onClick={onRetake}
            disabled={isProcessing}
          >
            {retakeLabel}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
