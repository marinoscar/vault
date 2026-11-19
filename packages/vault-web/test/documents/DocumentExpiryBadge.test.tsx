import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import type { DocumentExpiryStatus } from '@marinoscar/vault-contract/secrets';
import { render } from '../utils/test-utils.js';
import { DocumentExpiryBadge } from '../../src/documents/ui/components/DocumentExpiryBadge.js';

describe('DocumentExpiryBadge (IDOC-9)', () => {
  it.each<[DocumentExpiryStatus, string]>([
    ['expired', 'Expired'],
    ['expiring_soon', 'Expires soon'],
    ['valid', 'Valid'],
    ['no_expiry', 'No expiry'],
  ])('renders a text label and an icon for %s', (status, label) => {
    const { container } = render(<DocumentExpiryBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.querySelector('[data-status]')).toHaveAttribute('data-status', status);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('uses a distinct icon per status', () => {
    const icons = (['expired', 'expiring_soon', 'valid', 'no_expiry'] as DocumentExpiryStatus[]).map((status) => {
      const { container, unmount } = render(<DocumentExpiryBadge status={status} />);
      const testId = container.querySelector('svg')?.getAttribute('data-testid');
      unmount();
      return testId;
    });
    expect(new Set(icons).size).toBe(4);
  });

  it('includes the expiry date in the accessible label when known', () => {
    render(<DocumentExpiryBadge status="expiring_soon" expiryDate="2027-07-10" />);
    expect(screen.getByLabelText('Expires soon, expiry 2027-07-10')).toBeInTheDocument();
  });
});
