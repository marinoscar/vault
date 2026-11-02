import { Chip, Tooltip } from '@mui/material';
import {
  ErrorOutlineOutlined as ExpiredIcon,
  WarningAmber as ExpiringIcon,
  CheckCircleOutlineOutlined as ValidIcon,
  HelpOutlineOutlined as UnknownIcon,
} from '@mui/icons-material';
import { EXPIRING_SOON_DAYS, type CardExpiryStatus } from '../../headless/cardExpiry.js';

/**
 * Status badge for a card's expiry.
 *
 * Every state carries an icon AND a text label; colour is only ever a third,
 * redundant signal. A user who cannot distinguish the red and amber chips still
 * reads "Expired" vs "Expires soon", and the icon shapes differ too.
 *
 * States (E10.5, spec §8): `valid` is an outlined success chip; `expiring_soon`
 * (within EXPIRING_SOON_DAYS) is the brand amber FILL with dark slate text;
 * `expired` is a filled error chip; `unknown` is a neutral outline.
 */

interface StatusPresentation {
  label: string;
  icon: React.ReactElement;
  /**
   * `secondary` is the brand amber (spec §5): a FILL with slate text
   * (`secondary.contrastText`, 7.28:1), never amber text on a light surface.
   */
  color: 'error' | 'secondary' | 'success' | 'default';
  variant: 'filled' | 'outlined';
  tooltip: string;
}

const PRESENTATION: Record<CardExpiryStatus, StatusPresentation> = {
  expired: {
    label: 'Expired',
    icon: <ExpiredIcon fontSize="small" />,
    color: 'error',
    variant: 'filled',
    tooltip: 'This card has passed its expiry date.',
  },
  expiring_soon: {
    label: 'Expires soon',
    icon: <ExpiringIcon fontSize="small" />,
    color: 'secondary',
    variant: 'filled',
    tooltip: `This card expires within ${EXPIRING_SOON_DAYS} days.`,
  },
  valid: {
    label: 'Valid',
    icon: <ValidIcon fontSize="small" />,
    color: 'success',
    variant: 'outlined',
    tooltip: 'This card is valid.',
  },
  unknown: {
    label: 'Unknown expiry',
    icon: <UnknownIcon fontSize="small" />,
    color: 'default',
    variant: 'outlined',
    tooltip: 'No usable expiry date is stored for this card.',
  },
};

interface CardExpiryBadgeProps {
  status: CardExpiryStatus;
  /** `MM/YY`, appended to the accessible label when known. */
  expiryLabel?: string;
}

export function CardExpiryBadge({ status, expiryLabel }: CardExpiryBadgeProps) {
  const presentation = PRESENTATION[status] ?? PRESENTATION.unknown;

  // Screen readers get the date alongside the status, which sighted users read
  // from the adjacent expiry field.
  const accessibleLabel = expiryLabel
    ? `${presentation.label}, expiry ${expiryLabel}`
    : presentation.label;

  return (
    <Tooltip title={presentation.tooltip}>
      <Chip
        icon={presentation.icon}
        label={presentation.label}
        color={presentation.color}
        size="small"
        variant={presentation.variant}
        aria-label={accessibleLabel}
        data-status={status}
        sx={{ fontWeight: 600 }}
      />
    </Tooltip>
  );
}
