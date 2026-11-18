import { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, IconButton, Paper, Tooltip, Typography } from '@mui/material';
import {
  Check as CheckIcon,
  ContentCopy as CopyIcon,
  ErrorOutlineOutlined as ErrorIcon,
  VisibilityOff as HideIcon,
} from '@mui/icons-material';
import { visuallyHidden } from '@mui/utils';
import { useCopyToClipboard } from '../../../core/headless/useCopyToClipboard.js';
import { SECRET_CLIPBOARD_CLEAR_MS } from '../../headless/secretFields.js';
import { groupTotpCode, useTotpCode } from '../../headless/useTotpCode.js';

const RING = 36;
const STROKE = 4;
const RADIUS = (RING - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** A countdown ring; decorative (the seconds are announced as text beside it). */
function CountdownRing({ fraction, seconds }: { fraction: number; seconds: number }) {
  return (
    <Box sx={{ position: 'relative', width: RING, height: RING, flexShrink: 0 }} aria-hidden>
      <svg width={RING} height={RING} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={RING / 2} cy={RING / 2} r={RADIUS} fill="none" strokeWidth={STROKE} stroke="currentColor" opacity={0.15} />
        <circle
          cx={RING / 2}
          cy={RING / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          stroke="currentColor"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
        />
      </svg>
      <Typography
        variant="caption"
        sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontWeight: 600 }}
      >
        {seconds}
      </Typography>
    </Box>
  );
}

/**
 * The authenticator code of a login: nothing is requested until "Show code",
 * then the code, its countdown and a copy button, refreshed on expiry while
 * visible. The seed is never displayed here.
 */
export function TotpCodeCard({ secretId }: { secretId: string }) {
  const { status, code, period, remainingMs, error, show, hide } = useTotpCode(secretId);
  const { copy, copied, failed } = useCopyToClipboard({ clearAfterMs: SECRET_CLIPBOARD_CLEAR_MS });
  const [announce, setAnnounce] = useState('');

  const seconds = Math.ceil(remainingMs / 1000);
  const fraction = Math.min(1, remainingMs / (period * 1000));

  // Announce only when a fresh code appears, not on every tick.
  useEffect(() => {
    setAnnounce(code ? 'New authenticator code available' : '');
  }, [code]);

  const title = copied ? 'Copied' : failed ? 'Copy failed' : 'Copy code';

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, px: 2, py: 1.5, mt: 2, minWidth: 0 }}>
      <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>
        Authenticator code
      </Typography>
      {status === 'idle' && (
        <Box sx={{ mt: 0.5 }}>
          <Button size="small" variant="outlined" onClick={show}>
            Show code
          </Button>
        </Box>
      )}
      {status === 'loading' && !code && (
        <Box sx={{ py: 1 }}>
          <CircularProgress size={20} aria-label="Getting code" />
        </Box>
      )}
      {status === 'error' && (
        <Box sx={{ mt: 0.5 }}>
          <Alert
            severity="error"
            variant="outlined"
            action={
              <Button color="inherit" size="small" onClick={show}>
                Retry
              </Button>
            }
          >
            {error}
          </Alert>
        </Box>
      )}
      {code && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 0.5, flexWrap: 'wrap' }}>
          <Typography
            component="div"
            aria-label="Authenticator code"
            sx={{ fontFamily: 'monospace', fontSize: '1.6rem', fontWeight: 700, letterSpacing: 2 }}
          >
            {groupTotpCode(code)}
          </Typography>
          <CountdownRing fraction={fraction} seconds={seconds} />
          <Box sx={{ display: 'flex', ml: 'auto' }}>
            <Tooltip title={title}>
              <IconButton
                size="small"
                aria-label="Copy code"
                onClick={() => void copy(code)}
              >
                {copied ? (
                  <CheckIcon fontSize="small" color="success" />
                ) : failed ? (
                  <ErrorIcon fontSize="small" color="error" />
                ) : (
                  <CopyIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
            <Tooltip title="Hide code">
              <IconButton size="small" aria-label="Hide code" onClick={hide}>
                <HideIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      )}
      {code && (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Expires in {seconds}s
        </Typography>
      )}
      <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
        {failed ? 'Copy failed. Clipboard is unavailable.' : announce}
      </Box>
    </Paper>
  );
}
