import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../../utils/test-utils';
import { CardExpiryBadge } from '../../../components/cards/CardExpiryBadge';
import type { CardExpiryStatus } from '../../../utils/cardExpiry';

describe('CardExpiryBadge', () => {
  it.each<[CardExpiryStatus, string]>([
    ['expired', 'Expired'],
    ['expiring_soon', 'Expires soon'],
    ['valid', 'Valid'],
    ['unknown', 'Unknown expiry'],
  ])('renders a text label for %s', (status, label) => {
    render(<CardExpiryBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('conveys status with an icon as well as text, never colour alone', () => {
    const { container } = render(<CardExpiryBadge status="expired" />);

    // Text label present...
    expect(screen.getByText('Expired')).toBeInTheDocument();
    // ...alongside an icon, so the meaning survives without colour perception.
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('uses a distinct icon per status', () => {
    const icons = (['expired', 'expiring_soon', 'valid', 'unknown'] as CardExpiryStatus[]).map(
      (status) => {
        const { container, unmount } = render(<CardExpiryBadge status={status} />);
        const testId = container.querySelector('svg')?.getAttribute('data-testid');
        unmount();
        return testId;
      },
    );

    expect(new Set(icons).size).toBe(4);
  });

  it('includes the expiry date in the accessible label when known', () => {
    render(<CardExpiryBadge status="expiring_soon" expiryLabel="07/26" />);
    expect(screen.getByLabelText('Expires soon, expiry 07/26')).toBeInTheDocument();
  });

  it('falls back to the status alone when no expiry is known', () => {
    render(<CardExpiryBadge status="unknown" />);
    expect(screen.getByLabelText('Unknown expiry')).toBeInTheDocument();
  });

  // E10.5 / spec §5 and §8: expiring soon is the brand amber as a FILL with
  // dark slate text (never amber text); expired is a filled error chip; valid
  // is a quiet outline.
  it.each<[CardExpiryStatus, string, string]>([
    ['expired', 'MuiChip-colorError', 'MuiChip-filled'],
    ['expiring_soon', 'MuiChip-colorSecondary', 'MuiChip-filled'],
    ['valid', 'MuiChip-colorSuccess', 'MuiChip-outlined'],
    ['unknown', 'MuiChip-colorDefault', 'MuiChip-outlined'],
  ])('styles %s as %s %s', (status, colorClass, variantClass) => {
    const { container } = render(<CardExpiryBadge status={status} />);
    const chip = container.querySelector('.MuiChip-root');
    expect(chip).toHaveClass(colorClass);
    expect(chip).toHaveClass(variantClass);
  });

  it('paints "expires soon" as an amber fill with dark text', () => {
    const { container } = render(<CardExpiryBadge status="expiring_soon" />);
    const chip = container.querySelector('.MuiChip-root') as HTMLElement;
    const style = getComputedStyle(chip);
    // BRAND_TOKENS accent #F2A900 with onAccent #1E293B (7.28:1).
    expect(style.backgroundColor).toBe('rgb(242, 169, 0)');
    expect(style.color).toBe('rgb(30, 41, 59)');
  });
});
