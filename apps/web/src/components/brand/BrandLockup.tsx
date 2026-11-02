import Box from '@mui/material/Box';
import type { ReactElement } from 'react';

import markUrl from '../../assets/brand/vault-mark.png';
import { PRODUCT_NAME } from '../../theme/tokens';

export interface BrandLockupProps {
  /** Side of the mark in CSS pixels. Default 32. */
  size?: number;
  /** Draw the product name beside the mark. Default true. */
  showName?: boolean;
}

/**
 * The Vault mark (generated from `media/app_logo.png`, tinted to the teal
 * primary; 128px source, so it stays crisp at 32px on a 4x screen) and the
 * product name. A plain inline row: the app bar wraps it in its home button.
 * With the name shown the mark is decorative, so the name is announced once.
 */
export function BrandLockup({ size = 32, showName = true }: BrandLockupProps = {}): ReactElement {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.25 }}>
      <Box
        component="img"
        src={markUrl}
        alt={showName ? '' : PRODUCT_NAME}
        width={size}
        height={size}
        sx={{ display: 'block', borderRadius: '22%', flexShrink: 0 }}
      />
      {showName && (
        <Box component="span" sx={{ fontWeight: 700, letterSpacing: '-0.01em', color: 'text.primary' }}>
          {PRODUCT_NAME}
        </Box>
      )}
    </Box>
  );
}
