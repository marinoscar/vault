import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../utils/test-utils';
import CardsPage from '../../pages/CardsPage';
import type { CardSummary } from '../../hooks/useCards';

vi.mock('../../hooks/useCards', () => ({
  useCards: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

import { useCards } from '../../hooks/useCards';

const mockUseCards = vi.mocked(useCards);

function makeSummary(overrides: Partial<CardSummary> & { id: string }): CardSummary {
  return {
    name: overrides.id,
    description: null,
    network: 'Visa',
    kind: 'Credit',
    cardholderName: 'Ada Lovelace',
    issuingBank: '',
    maskedNumber: '•••• •••• •••• 4242',
    expiryLabel: '12/29',
    status: 'valid',
    expirySortKey: 0,
    hasAttachments: false,
    updatedAt: new Date('2024-01-01').toISOString(),
    ...overrides,
  };
}

const fetchCards = vi.fn();

function mockCards(cards: CardSummary[], extra?: Partial<ReturnType<typeof useCards>>) {
  mockUseCards.mockReturnValue({
    cards,
    totalItems: cards.length,
    isTruncated: false,
    isLoading: false,
    error: null,
    fetchCards,
    ...extra,
  });
}

describe('CardsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCards([]);
  });

  it('shows an empty state when the user has no cards', () => {
    mockCards([]);
    render(<CardsPage />);

    expect(screen.getByText('No cards yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add a card/i })).toBeInTheDocument();
  });

  it('renders card details including the masked number', () => {
    mockCards([makeSummary({ id: 'card-1' })]);
    render(<CardsPage />);

    expect(screen.getByText('Visa')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('•••• •••• •••• 4242')).toBeInTheDocument();
    expect(screen.getByText('12/29')).toBeInTheDocument();
  });

  it('never renders a full card number', () => {
    mockCards([makeSummary({ id: 'card-1' })]);
    const { container } = render(<CardsPage />);

    expect(container.textContent).not.toMatch(/\d{13,}/);
  });

  it('counts expired and expiring cards in the header', () => {
    mockCards([
      makeSummary({ id: 'a', status: 'expired' }),
      makeSummary({ id: 'b', status: 'expiring_soon' }),
      makeSummary({ id: 'c', status: 'expiring_soon' }),
      makeSummary({ id: 'd', status: 'valid' }),
    ]);
    render(<CardsPage />);

    expect(screen.getByText(/1 expired/)).toBeInTheDocument();
    expect(screen.getByText(/2 expiring soon/)).toBeInTheDocument();
  });

  it('reports when nothing needs attention', () => {
    mockCards([makeSummary({ id: 'a' }), makeSummary({ id: 'b' })]);
    render(<CardsPage />);

    expect(screen.getByText(/none expiring soon/i)).toBeInTheDocument();
  });

  it('filters to cards that need attention', async () => {
    const user = userEvent.setup();
    mockCards([
      makeSummary({ id: 'a', network: 'ExpiredCard', status: 'expired' }),
      makeSummary({ id: 'b', network: 'SoonCard', status: 'expiring_soon' }),
      makeSummary({ id: 'c', network: 'GoodCard', status: 'valid' }),
      makeSummary({ id: 'd', network: 'MysteryCard', status: 'unknown' }),
    ]);
    render(<CardsPage />);

    expect(screen.getByText('GoodCard')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /needs attention/i }));

    await waitFor(() => expect(screen.queryByText('GoodCard')).not.toBeInTheDocument());
    expect(screen.getByText('ExpiredCard')).toBeInTheDocument();
    expect(screen.getByText('SoonCard')).toBeInTheDocument();
    // 'unknown' is not actionable, so it is not "needs attention".
    expect(screen.queryByText('MysteryCard')).not.toBeInTheDocument();
  });

  it('preserves soonest-first order from the hook', () => {
    mockCards([
      makeSummary({ id: 'first', network: 'AAA', status: 'expired' }),
      makeSummary({ id: 'second', network: 'BBB', status: 'expiring_soon' }),
      makeSummary({ id: 'third', network: 'CCC', status: 'valid' }),
    ]);
    const { container } = render(<CardsPage />);

    const text = container.textContent ?? '';
    expect(text.indexOf('AAA')).toBeLessThan(text.indexOf('BBB'));
    expect(text.indexOf('BBB')).toBeLessThan(text.indexOf('CCC'));
  });

  it('disables the import action and explains it is coming soon', async () => {
    mockCards([]);
    render(<CardsPage />);

    const importButton = screen.getByRole('button', { name: /import credit card/i });
    expect(importButton).toBeDisabled();

    // The tooltip lives on a wrapper span because a disabled button emits no
    // pointer events.
    await waitFor(() =>
      expect(importButton.parentElement).toHaveAttribute('aria-label', 'Coming soon'),
    );
  });

  it('renders a card missing network / kind without error', () => {
    mockCards([
      makeSummary({
        id: 'legacy',
        name: 'Legacy Card',
        network: '',
        kind: '',
        expiryLabel: '',
        status: 'unknown',
      }),
    ]);
    render(<CardsPage />);

    // Falls back to the secret's own name when there is no network.
    expect(screen.getByText('Legacy Card')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('Unknown expiry')).toBeInTheDocument();
  });

  it('navigates to the secret detail when a card is clicked', async () => {
    const user = userEvent.setup();
    mockCards([makeSummary({ id: 'card-42' })]);
    render(<CardsPage />);

    await user.click(screen.getByText('Visa'));
    expect(mockNavigate).toHaveBeenCalledWith('/secrets/card-42');
  });

  it('shows an error alert when loading fails', () => {
    mockCards([], { error: 'Boom' });
    render(<CardsPage />);

    expect(screen.getByText('Boom')).toBeInTheDocument();
  });

  it('warns when the card list is truncated', () => {
    mockCards([makeSummary({ id: 'a' })], { isTruncated: true, totalItems: 250 });
    render(<CardsPage />);

    expect(screen.getByText(/showing the first 1 of 250 cards/i)).toBeInTheDocument();
  });

  it('filters by search term', async () => {
    const user = userEvent.setup();
    mockCards([
      makeSummary({ id: 'a', network: 'Visa', cardholderName: 'Ada' }),
      makeSummary({ id: 'b', network: 'Amex', cardholderName: 'Grace' }),
    ]);
    render(<CardsPage />);

    await user.type(screen.getByLabelText(/search cards/i), 'Amex');

    await waitFor(() => expect(screen.queryByText('Visa')).not.toBeInTheDocument());
    expect(screen.getByText('Amex')).toBeInTheDocument();
  });
});
