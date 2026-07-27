import { Box, Chip, Typography } from '@mui/material';
import { ArrowForward as ArrowIcon } from '@mui/icons-material';

import type { FieldDefinition } from '../../types';

/**
 * How many trailing characters of a sensitive value the diff reveals.
 *
 * Enough to recognise the outgoing card, short of reconstructing it.
 */
const SENSITIVE_TAIL = 4;

const EMPTY_PLACEHOLDER = '—';

/**
 * Render a value for the comparison line.
 *
 * Sensitive values are reduced to their last few characters. The editable field
 * above this line already has a reveal toggle for the NEW value, so the user can
 * see in full whatever they are about to save; the OLD value has no such toggle
 * and no reason for one — "is this the card ending 4242?" is the entire question
 * the old value has to answer, and printing a full PAN to answer it would put a
 * live card number on screen that nobody asked to see.
 */
export function formatDiffValue(value: string, sensitive: boolean): string {
  const trimmed = value.trim();
  if (trimmed === '') return EMPTY_PLACEHOLDER;
  if (!sensitive) return trimmed;
  if (trimmed.length <= SENSITIVE_TAIL) return '••••';
  return `•••• ${trimmed.slice(-SENSITIVE_TAIL)}`;
}

interface CardFieldDiffProps {
  field: FieldDefinition;
  /** The outgoing version's value. */
  current: string;
  /** What is about to be saved. */
  proposed: string;
  changed: boolean;
  /**
   * True for the field that is never carried forward, so the line explains the
   * absence instead of showing a misleading "no current value".
   */
  notCarriedForward?: boolean;
}

/**
 * One field's before/after, shown beneath its input on the renewal review.
 *
 * This is the step that distinguishes a renewal from an import: the user is not
 * confirming values in a vacuum, they are confirming a CHANGE to a card they
 * already hold, and the thing worth checking is which fields moved. Unchanged
 * fields are stated explicitly rather than hidden — "cardholder stays the same"
 * is information, and a field that silently shows nothing reads as a field that
 * was forgotten.
 */
export function CardFieldDiff({
  field,
  current,
  proposed,
  changed,
  notCarriedForward = false,
}: CardFieldDiffProps) {
  const label = `${field.label}: ${
    notCarriedForward
      ? 'not carried over from the old card'
      : changed
        ? `changes from ${formatDiffValue(current, field.sensitive)} to ${formatDiffValue(proposed, field.sensitive)}`
        : 'unchanged'
  }`;

  return (
    <Box
      aria-label={label}
      sx={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 0.75,
        mt: 0.5,
        pl: 1.5,
        borderLeft: 2,
        borderColor: changed ? 'primary.main' : 'divider',
      }}
    >
      {notCarriedForward ? (
        <>
          <Chip
            label="New code needed"
            size="small"
            color="info"
            variant="outlined"
            sx={{ height: 20, fontSize: 11 }}
          />
          <Typography variant="caption" color="text.secondary">
            The old card's code is never reused.
          </Typography>
        </>
      ) : (
        <>
          <Chip
            label={changed ? 'Changes' : 'Unchanged'}
            size="small"
            color={changed ? 'primary' : 'default'}
            variant="outlined"
            sx={{ height: 20, fontSize: 11 }}
          />
          <Typography variant="caption" color="text.secondary">
            Current
          </Typography>
          <Typography
            variant="caption"
            sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
          >
            {formatDiffValue(current, field.sensitive)}
          </Typography>
          {changed && (
            <>
              <ArrowIcon
                aria-hidden="true"
                sx={{ fontSize: 14, color: 'text.secondary' }}
              />
              <Typography
                variant="caption"
                color="primary.main"
                sx={{ fontFamily: 'monospace', fontWeight: 600, wordBreak: 'break-all' }}
              >
                {formatDiffValue(proposed, field.sensitive)}
              </Typography>
            </>
          )}
        </>
      )}
    </Box>
  );
}
