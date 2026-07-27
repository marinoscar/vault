import { Chip, Tooltip } from '@mui/material';
import {
  ErrorOutline as ExpiredIcon,
  WarningAmber as ExpiringIcon,
  CheckCircleOutline as ValidIcon,
  HelpOutline as UnknownIcon,
} from '@mui/icons-material';
import { EXPIRING_SOON_DAYS, type CardExpiryStatus } from '../../utils/cardExpiry';

/**
 * Status badge for a card's expiry.
 *
 * Every state carries an icon AND a text label; colour is only ever a third,
 * redundant signal. A user who cannot distinguish the red and amber chips still
 * reads "Expired" vs "Expires soon", and the icon shapes differ too.
 */

interface StatusPresentation {
  label: string;
  icon: React.ReactElement;
  color: 'error' | 'warning' | 'success' | 'default';
  tooltip: string;
}

const PRESENTATION: Record<CardExpiryStatus, StatusPresentation> = {
  expired: {
    label: 'Expired',
    icon: <ExpiredIcon fontSize="small" />,
    color: 'error',
    tooltip: 'This card has passed its expiry date.',
  },
  expiring_soon: {
    label: 'Expires soon',
    icon: <ExpiringIcon fontSize="small" />,
    color: 'warning',
    tooltip: `This card expires within ${EXPIRING_SOON_DAYS} days.`,
  },
  valid: {
    label: 'Valid',
    icon: <ValidIcon fontSize="small" />,
    color: 'success',
    tooltip: 'This card is valid.',
  },
  unknown: {
    label: 'Unknown expiry',
    icon: <UnknownIcon fontSize="small" />,
    color: 'default',
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
        variant={status === 'valid' ? 'outlined' : 'filled'}
        aria-label={accessibleLabel}
      />
    </Tooltip>
  );
}
