import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import {
  ExpiringCardsPanel,
  EXPIRING_CARDS_LIMIT,
  shortMask,
} from '../../../components/home/ExpiringCardsPanel';
import { LocationProbe, makeCardSummary } from './homeFixtures';

const expired = makeCardSummary({ id: 'c1', name: 'Test Visa travel', status: 'expired', expiryLabel: '10/26' });
const soon = makeCardSummary({
  id: 'c2',
  name: 'Test Mastercard',
  status: 'expiring_soon',
  maskedNumber: '•••• •••• •••• 4444',
  expiryLabel: '12/26',
});
const valid = makeCardSummary({ id: 'c3', name: 'Test Discover', status: 'valid', expiryLabel: '08/29' });
const unknown = makeCardSummary({ id: 'c4', name: 'Test Amex', status: 'unknown', expiryLabel: '' });

function renderPanel(props: Partial<Parameters<typeof ExpiringCardsPanel>[0]> = {}) {
  return render(
    <>
      <ExpiringCardsPanel status="ready" cards={[]} error={null} onRetry={vi.fn()} canRenew {...props} />
      <LocationProbe />
    </>,
  );
}

describe('ExpiringCardsPanel', () => {
  it('is a labelled section with a link to the filtered Cards gallery', () => {
    renderPanel();

    expect(screen.getByRole('region', { name: 'Cards needing attention' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View cards needing attention' })).toHaveAttribute(
      'href',
      '/cards?filter=attention',
    );
    expect(screen.getByText('Expired or expiring within 60 days')).toBeInTheDocument();
  });

  it('shows skeletons and no rows while loading', () => {
    renderPanel({ status: 'loading', cards: [expired] });

    expect(screen.getByLabelText('Loading cards')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Test Visa travel')).not.toBeInTheDocument();
  });

  it('shows the error with a retry that calls back', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    renderPanel({ status: 'error', error: 'Network down', onRetry });

    expect(screen.getByRole('alert')).toHaveTextContent('Network down');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('says no cards are saved when the wallet is empty', () => {
    renderPanel();

    expect(screen.getByText('No cards saved yet.')).toBeInTheDocument();
  });

  it('says nothing expires soon when every card is valid or unknown', () => {
    renderPanel({ cards: [valid, unknown] });

    expect(screen.getByText('No card expires in the next 60 days.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('admits an incomplete check when the wallet was truncated', () => {
    renderPanel({ cards: [valid], isTruncated: true });

    expect(screen.getByText(/Only your first 100 cards were checked/)).toBeInTheDocument();
  });

  it('lists only expired and expiring cards, in the order given, with a status in words', () => {
    renderPanel({ cards: [expired, soon, valid, unknown] });

    const rows = within(screen.getByRole('list', { name: 'Cards needing attention' })).getAllByRole('link');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Test Visa travel');
    expect(rows[0]).toHaveTextContent('Expired');
    expect(rows[1]).toHaveTextContent('Test Mastercard');
    expect(rows[1]).toHaveTextContent('Expires soon');
    expect(screen.queryByText('Test Discover')).not.toBeInTheDocument();
  });

  it('shows the last four digits and the expiry, never a longer number', () => {
    renderPanel({ cards: [soon] });

    expect(screen.getByText('•••• 4444 · Exp 12/26')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d{5,}/);
  });

  it('opens the renew flow for a writer', async () => {
    const user = userEvent.setup();
    renderPanel({ cards: [expired] });

    await user.click(screen.getByRole('link', { name: /Test Visa travel/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/cards/c1/renew');
  });

  it('opens the card detail for a reader who cannot renew', () => {
    renderPanel({ cards: [expired], canRenew: false });

    expect(screen.getByRole('link', { name: /Test Visa travel/ })).toHaveAttribute('href', '/secrets/c1');
  });

  it(`caps the list at ${EXPIRING_CARDS_LIMIT} rows and counts the rest`, () => {
    const many = Array.from({ length: EXPIRING_CARDS_LIMIT + 2 }, (_, i) =>
      makeCardSummary({ id: `m${i}`, name: `Test card ${i}`, status: 'expired' }),
    );
    renderPanel({ cards: many });

    expect(within(screen.getByRole('list')).getAllByRole('link')).toHaveLength(EXPIRING_CARDS_LIMIT);
    expect(screen.getByText('+2 more in Cards')).toBeInTheDocument();
  });
});

describe('shortMask', () => {
  it.each([
    ['•••• •••• •••• 4242', '•••• 4242'],
    ['•••• •••••• •0005', '•••• •0005'],
    ['••••', '••••'],
    ['', ''],
  ])('%s -> %s', (input, expected) => {
    expect(shortMask(input)).toBe(expected);
  });
});
