import { useEffect, useState } from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import {
  Check as CheckIcon,
  ContentCopy as CopyIcon,
  ErrorOutlineOutlined as ErrorIcon,
  Visibility as RevealIcon,
  VisibilityOff as HideIcon,
} from '@mui/icons-material';
import { visuallyHidden } from '@mui/utils';
import { useCopyToClipboard } from '../../../core/headless/useCopyToClipboard.js';
import {
  SECRET_CLIPBOARD_CLEAR_MS,
  SECRET_REVEAL_TIMEOUT_MS,
  formatSecretValueForCopy,
} from '../../headless/secretFields.js';
import type { FieldDefinition } from '../../../core/headless/types.js';
import { maskLast4 } from '../../headless/masking.js';
import { toKeyValueEntries } from '../../headless/keyValue.js';
import { formatCountryValue } from '../../headless/country.js';

export const MASK = '••••••••••••';

interface SecretValueFieldProps {
  field: FieldDefinition;
  /**
   * The decrypted value from the detail response; '' when empty. A `keyvalue`
   * field's value is its entry array.
   */
  value: unknown;
  /** Masks again after this many ms; defaults to {@link SECRET_REVEAL_TIMEOUT_MS}. */
  revealTimeoutMs?: number;
}

/**
 * One field of a secret, read-only. A sensitive value is masked until the
 * user reveals it and masks itself again after a timeout (and on unmount,
 * i.e. navigation). Copy reads the stored value, so a sensitive field can be
 * copied without ever being shown; the clipboard is cleared after
 * {@link SECRET_CLIPBOARD_CLEAR_MS} when the browser allows a readback and it
 * still holds what was copied. Outcomes are announced in a polite live region;
 * the value itself is never put in an accessible name.
 *
 * `mask: 'last4'` masks as `•••• ` plus the last four characters. A `keyvalue`
 * field renders one row per entry, each with its own copy and, for a sensitive
 * entry, its own reveal that masks again after the same timeout. A `country`
 * field shows `"<name> (<code>)"` and copies the code.
 */
export function SecretValueField({
  field,
  value,
  revealTimeoutMs = SECRET_REVEAL_TIMEOUT_MS,
}: SecretValueFieldProps) {
  if (field.type === 'keyvalue') {
    return <KeyValueValue field={field} value={value} revealTimeoutMs={revealTimeoutMs} />;
  }
  return (
    <ScalarValue
      field={field}
      value={value === undefined || value === null ? '' : String(value)}
      revealTimeoutMs={revealTimeoutMs}
    />
  );
}

function KeyValueValue({
  field,
  value,
  revealTimeoutMs,
}: {
  field: FieldDefinition;
  value: unknown;
  revealTimeoutMs: number;
}) {
  const entries = toKeyValueEntries(value);
  return (
    <Box data-testid={`secret-field-${field.name}`} sx={{ py: 1.25, minWidth: 0 }}>
      <Typography
        variant="caption"
        component="div"
        sx={{ color: 'text.secondary', fontWeight: 500, px: 2 }}
      >
        {field.label}
      </Typography>
      {entries.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.disabled', px: 2 }}>
          —
        </Typography>
      ) : (
        <Box component="ul" aria-label={field.label} sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {entries.map((entry, index) => (
            <Box component="li" key={entry.key || index} sx={{ '& > div': { py: 0.5 } }}>
              <ScalarValue
                field={{
                  name: `${field.name}.${entry.key || index}`,
                  label: entry.label,
                  type: 'string',
                  required: false,
                  sensitive: entry.sensitive,
                }}
                value={entry.value}
                revealTimeoutMs={revealTimeoutMs}
              />
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

function ScalarValue({
  field,
  value,
  revealTimeoutMs,
}: {
  field: FieldDefinition;
  value: string;
  revealTimeoutMs: number;
}) {
  const [revealed, setRevealed] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const { copy, copied, failed } = useCopyToClipboard({ clearAfterMs: SECRET_CLIPBOARD_CLEAR_MS });
  const masked = field.sensitive && !revealed;
  const empty = value === '';

  useEffect(() => {
    if (!revealed) return undefined;
    const timer = setTimeout(() => {
      setRevealed(false);
      setAnnouncement(`${field.label} hidden`);
    }, revealTimeoutMs);
    return () => clearTimeout(timer);
  }, [revealed, revealTimeoutMs, field.label]);

  const toggleReveal = () => {
    const next = !revealed;
    setRevealed(next);
    setAnnouncement(`${field.label} ${next ? 'revealed' : 'hidden'}`);
  };

  const handleCopy = async () => {
    const ok = await copy(formatSecretValueForCopy(value, field.name));
    setAnnouncement(
      ok
        ? `${field.label} copied. The clipboard is cleared in ${Math.round(SECRET_CLIPBOARD_CLEAR_MS / 1000)} seconds.`
        : 'Copy failed. Clipboard is unavailable.',
    );
  };

  const multiline = !field.sensitive && value.includes('\n');
  const maskedText = field.mask === 'last4' ? maskLast4(value) || MASK : MASK;
  const display = field.format === 'country' ? formatCountryValue(value) : value;

  return (
    <Box
      data-testid={`secret-field-${field.name}`}
      sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1.25, px: 2, minWidth: 0 }}
    >
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography
          variant="caption"
          component="div"
          sx={{ color: 'text.secondary', fontWeight: 500 }}
        >
          {field.label}
        </Typography>
        {empty ? (
          <Typography variant="body2" sx={{ color: 'text.disabled' }}>
            —
          </Typography>
        ) : (
          <Typography
            variant="body2"
            component="div"
            data-testid={`secret-value-${field.name}`}
            sx={{
              fontFamily: field.sensitive ? 'monospace' : undefined,
              letterSpacing: masked ? '0.1em' : undefined,
              whiteSpace: multiline ? 'pre-wrap' : undefined,
              overflowWrap: 'anywhere',
              mt: 0.25,
            }}
          >
            {masked ? maskedText : display}
          </Typography>
        )}
      </Box>
      {!empty && (
        <Box sx={{ display: 'flex', flexShrink: 0, alignSelf: 'center' }}>
          {field.sensitive && (
            <Tooltip title={revealed ? 'Hide' : 'Reveal'}>
              <IconButton
                onClick={toggleReveal}
                aria-label={`${revealed ? 'Hide' : 'Reveal'} ${field.label}`}
                aria-pressed={revealed}
              >
                {revealed ? <HideIcon fontSize="small" /> : <RevealIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={copied ? 'Copied' : failed ? 'Copy failed' : 'Copy'}>
            <IconButton onClick={() => void handleCopy()} aria-label={`Copy ${field.label}`}>
              {copied ? (
                <CheckIcon fontSize="small" color="success" />
              ) : failed ? (
                <ErrorIcon fontSize="small" color="error" />
              ) : (
                <CopyIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
        </Box>
      )}
      <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
        {announcement}
      </Box>
    </Box>
  );
}
