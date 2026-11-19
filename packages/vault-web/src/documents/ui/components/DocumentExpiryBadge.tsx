import { Chip, Tooltip } from '@mui/material';
import {
  ErrorOutlineOutlined as ExpiredIcon,
  WarningAmber as ExpiringIcon,
  CheckCircleOutlineOutlined as ValidIcon,
  HelpOutlineOutlined as UnknownIcon,
} from '@mui/icons-material';
import type { DocumentExpiryStatus } from '@marinoscar/vault-contract/secrets';

/**
 * Status badge for an identity document's expiry (IDOC-9), modelled on `CardExpiryBadge`.
 *
 * Every state carries an icon AND a text label; colour is only ever a third, redundant signal.
 * `expiring_soon` means within the largest reminder lead day of the document's kind (a passport:
 * 270 days), so the tooltip names the kind's window rather than a fixed number.
 */

interface StatusPresentation {
  label: string;
  icon: React.ReactElement;
  /** `secondary` is the brand amber: a FILL with slate text, never amber text on a light surface. */
  color: 'error' | 'secondary' | 'success' | 'default';
  variant: 'filled' | 'outlined';
  tooltip: string;
}

const PRESENTATION: Record<DocumentExpiryStatus, StatusPresentation> = {
  expired: {
    label: 'Expired',
    icon: <ExpiredIcon fontSize="small" />,
    color: 'error',
    variant: 'filled',
    tooltip: 'This document has passed its expiry date.',
  },
  expiring_soon: {
    label: 'Expires soon',
    icon: <ExpiringIcon fontSize="small" />,
    color: 'secondary',
    variant: 'filled',
    tooltip: 'This document is within its renewal reminder window.',
  },
  valid: {
    label: 'Valid',
    icon: <ValidIcon fontSize="small" />,
    color: 'success',
    variant: 'outlined',
    tooltip: 'This document is valid.',
  },
  no_expiry: {
    label: 'No expiry',
    icon: <UnknownIcon fontSize="small" />,
    color: 'default',
    variant: 'outlined',
    tooltip: 'No usable expiry date is stored for this document.',
  },
};

export interface DocumentExpiryBadgeProps {
  status: DocumentExpiryStatus;
  /** `YYYY-MM-DD`, appended to the accessible label when known. */
  expiryDate?: string | null;
}

export function DocumentExpiryBadge({ status, expiryDate }: DocumentExpiryBadgeProps) {
  const presentation = PRESENTATION[status] ?? PRESENTATION.no_expiry;
  const accessibleLabel = expiryDate ? `${presentation.label}, expiry ${expiryDate}` : presentation.label;

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
