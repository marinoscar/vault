import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { server } from '../mocks/server.js';
import type { ReactElement } from 'react';
import { mockUser, render as baseRender } from '../utils/test-utils.js';

/**
 * Renders as a member who may scan (`secrets:write` and `ai:use`, E8.2: the scan
 * option is hidden without `ai:use`) unless a test passes another user.
 */
const SCANNER = {
  ...mockUser,
  roles: [{ name: 'contributor' }],
  permissions: [...mockUser.permissions, 'secrets:read', 'secrets:write', 'ai:use'],
};
function render(ui: ReactElement, options: Parameters<typeof baseRender>[1] = {}) {
  return baseRender(ui, { ...options, wrapperOptions: { user: SCANNER, ...options.wrapperOptions } });
}
import CardsPage from '../../src/cards/ui/pages/CardsPage.js';
import type { CardSummary } from '../../src/cards/headless/useCards.js';

vi.mock('../../src/cards/headless/useCards.js', () => ({
  useCards: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

import { useCards } from '../../src/cards/headless/useCards.js';
import { useLocation } from 'react-router-dom';

/** Renders the router's current query string, to assert URL sync. */
function LocationProbe() {
  const { search } = useLocation();
  return <output data-testid="location-search">{search}</output>;
}

const mockUseCards = vi.mocked(useCards);

function makeSummary(overrides: Partial<CardSummary> & { id: string }): CardSummary {
  return {
    name: overrides.id,
    last4: '4242',
    maskedNumber: '•••• 4242',
    expiryLabel: '12/29',
    status: 'valid',
    expirySortKey: 0,
    network: 'Visa',
    kind: 'Credit',
    issuingBank: '',
    cardholderName: 'Person A',
    hasPhotos: false,
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

  it('shows an empty state with "Scan a card" and "Add manually" when the user has no cards', async () => {
    const user = userEvent.setup();
    mockCards([]);
    render(<CardsPage />);

    expect(screen.getByRole('heading', { name: 'No cards yet' })).toBeInTheDocument();
    // No toolbar over an empty gallery.
    expect(screen.queryByLabelText(/search cards/i)).not.toBeInTheDocument();

    // Scan is gated on the AI status (enabled by the default handler).
    await user.click(await screen.findByRole('button', { name: /scan a card/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/cards/import');

    await user.click(screen.getByRole('button', { name: /add manually/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/secrets/new');
  });

  it('offers only "Add manually" in the empty state when AI is disabled', async () => {
    server.use(
      http.get('*/api/ai/status', () =>
        HttpResponse.json({ data: { enabled: false, features: { cardExtract: false } } }),
      ),
    );
    mockCards([]);
    render(<CardsPage />);

    expect(screen.getByRole('button', { name: /add manually/i })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /scan a card/i })).not.toBeInTheDocument(),
    );
  });

  it('renders the card facts: name, network · kind · bank, last four, cardholder, expiry', () => {
    mockCards([
      makeSummary({ id: 'card-1', name: 'Org Alpha Rewards', issuingBank: 'Org Beta Bank' }),
    ]);
    render(<CardsPage />);

    expect(screen.getByRole('heading', { name: 'Org Alpha Rewards' })).toBeInTheDocument();
    expect(screen.getByText('Visa · Credit · Org Beta Bank')).toBeInTheDocument();
    expect(screen.getByText('•••• 4242')).toBeInTheDocument();
    expect(screen.getByText('Cardholder')).toBeInTheDocument();
    expect(screen.getByText('Person A')).toBeInTheDocument();
    expect(screen.getByText('12/29')).toBeInTheDocument();
  });

  it('shows the photo indicator only on a card with photos', () => {
    mockCards([
      makeSummary({ id: 'a', name: 'With Photos', hasPhotos: true }),
      makeSummary({ id: 'b', name: 'Without Photos' }),
    ]);
    render(<CardsPage />);

    const [withPhotos, withoutPhotos] = screen.getAllByTestId('card-tile');
    expect(within(withPhotos).getByTitle('Has card photos')).toBeInTheDocument();
    expect(within(withoutPhotos).queryByTitle('Has card photos')).not.toBeInTheDocument();
  });

  it('omits missing display fields rather than dashing them', () => {
    mockCards([
      makeSummary({
        id: 'bare',
        name: 'Bare Card',
        network: '',
        kind: '',
        issuingBank: '',
        cardholderName: '',
      }),
    ]);
    render(<CardsPage />);

    const tile = screen.getByTestId('card-tile');
    expect(within(tile).getByText('Bare Card')).toBeInTheDocument();
    expect(within(tile).queryByText('Cardholder')).not.toBeInTheDocument();
    // Only the expiry row: no subheading, no cardholder dash.
    expect(within(tile).queryAllByText('—')).toHaveLength(0);
  });

  it('renders a malformed card (null last4 and expiry) with dashes, not guesses', () => {
    mockCards([
      makeSummary({
        id: 'broken',
        name: 'Unreadable Card',
        last4: null,
        maskedNumber: '',
        expiryLabel: '',
        status: 'unknown',
      }),
    ]);
    render(<CardsPage />);

    const tile = screen.getByTestId('card-tile');
    expect(within(tile).getByText('Unreadable Card')).toBeInTheDocument();
    expect(within(tile).getByText('Visa · Credit')).toBeInTheDocument();
    expect(within(tile).getByText('•••• —')).toBeInTheDocument();
    expect(within(tile).getByText('—')).toBeInTheDocument();
    expect(within(tile).getByText('Unknown expiry')).toBeInTheDocument();
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

  describe('filter chips', () => {
    const WALLET = () => [
      makeSummary({ id: 'a', name: 'ExpiredCard', status: 'expired' }),
      makeSummary({ id: 'b', name: 'SoonCard', status: 'expiring_soon' }),
      makeSummary({ id: 'b2', name: 'SoonCard2', status: 'expiring_soon' }),
      makeSummary({ id: 'c', name: 'GoodCard', status: 'valid' }),
      makeSummary({ id: 'd', name: 'MysteryCard', status: 'unknown' }),
    ];

    it('offers All, Needs attention, Expiring soon and Expired with whole-wallet counts', () => {
      mockCards(WALLET());
      render(<CardsPage />);

      const group = screen.getByRole('group', { name: /filter cards/i });
      expect(within(group).getByRole('button', { name: 'All (5)' })).toHaveAttribute('aria-pressed', 'true');
      expect(within(group).getByRole('button', { name: 'Needs attention (3)' })).toHaveAttribute('aria-pressed', 'false');
      expect(within(group).getByRole('button', { name: 'Expiring soon (2)' })).toHaveAttribute('aria-pressed', 'false');
      expect(within(group).getByRole('button', { name: 'Expired (1)' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('shows only expiring cards under "Expiring soon"', async () => {
      const user = userEvent.setup();
      mockCards(WALLET());
      render(<CardsPage />);

      await user.click(screen.getByRole('button', { name: /^expiring soon/i }));

      await waitFor(() => expect(screen.queryByText('GoodCard')).not.toBeInTheDocument());
      expect(screen.getByText('SoonCard')).toBeInTheDocument();
      expect(screen.getByText('SoonCard2')).toBeInTheDocument();
      expect(screen.queryByText('ExpiredCard')).not.toBeInTheDocument();
      expect(screen.queryByText('MysteryCard')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^expiring soon/i })).toHaveAttribute('aria-pressed', 'true');
      // Counts describe the wallet, not the view.
      expect(screen.getByRole('button', { name: 'All (5)' })).toBeInTheDocument();
    });

    it('shows only expired cards under "Expired", and everything again under "All"', async () => {
      const user = userEvent.setup();
      mockCards(WALLET());
      render(<CardsPage />);

      await user.click(screen.getByRole('button', { name: /^expired \(/i }));
      await waitFor(() => expect(screen.queryByText('SoonCard')).not.toBeInTheDocument());
      expect(screen.getByText('ExpiredCard')).toBeInTheDocument();
      expect(screen.getAllByTestId('card-tile')).toHaveLength(1);

      await user.click(screen.getByRole('button', { name: /^all \(/i }));
      expect(screen.getAllByTestId('card-tile')).toHaveLength(5);
    });

    it('opens on "Needs attention" from ?filter=attention (the Home dashboard link)', () => {
      mockCards(WALLET());
      render(<CardsPage />, { wrapperOptions: { route: '/cards?filter=attention' } });

      expect(screen.getByRole('button', { name: 'Needs attention (3)' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getAllByTestId('card-tile').map((t) => t.getAttribute('data-status'))).toEqual([
        'expired',
        'expiring_soon',
        'expiring_soon',
      ]);
      // 'unknown' is not actionable, so it is not "needs attention".
      expect(screen.queryByText('MysteryCard')).not.toBeInTheDocument();
    });

    it.each([
      ['expired', 'Expired (1)'],
      ['expiring_soon', 'Expiring soon (2)'],
      ['expiring', 'Expiring soon (2)'],
      ['all', 'All (5)'],
      ['bogus', 'All (5)'],
    ])('reads ?filter=%s as the %s chip', (param, chip) => {
      mockCards(WALLET());
      render(<CardsPage />, { wrapperOptions: { route: `/cards?filter=${param}` } });
      expect(screen.getByRole('button', { name: chip })).toHaveAttribute('aria-pressed', 'true');
    });

    it('keeps ?filter= in sync as the user picks chips', async () => {
      const user = userEvent.setup();
      mockCards(WALLET());
      render(
        <>
          <CardsPage />
          <LocationProbe />
        </>,
        { wrapperOptions: { route: '/cards' } },
      );

      expect(screen.getByTestId('location-search')).toHaveTextContent(/^$/);
      await user.click(screen.getByRole('button', { name: /^expired \(/i }));
      expect(screen.getByTestId('location-search')).toHaveTextContent('?filter=expired');
      await user.click(screen.getByRole('button', { name: /^needs attention/i }));
      expect(screen.getByTestId('location-search')).toHaveTextContent('?filter=attention');
      await user.click(screen.getByRole('button', { name: /^all \(/i }));
      expect(screen.getByTestId('location-search')).toHaveTextContent(/^$/);
    });

    it('combines with search, and offers a way back when nothing matches', async () => {
      const user = userEvent.setup();
      mockCards(WALLET());
      render(<CardsPage />);

      await user.click(screen.getByRole('button', { name: /^expired \(/i }));
      await user.type(screen.getByLabelText(/search cards/i), 'Good');

      expect(await screen.findByText('No cards match your filters.')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /show all cards/i }));

      expect(screen.getAllByTestId('card-tile')).toHaveLength(5);
      expect(screen.getByLabelText(/search cards/i)).toHaveValue('');
    });
  });

  it('gives every tile its expiry state, in words', () => {
    mockCards([
      makeSummary({ id: 'a', name: 'ExpiredCard', status: 'expired', expiryLabel: '01/24' }),
      makeSummary({ id: 'b', name: 'SoonCard', status: 'expiring_soon', expiryLabel: '12/26' }),
      makeSummary({ id: 'c', name: 'GoodCard', status: 'valid' }),
    ]);
    render(<CardsPage />);

    const tiles = screen.getAllByTestId('card-tile');
    expect(tiles.map((tile) => tile.getAttribute('data-status'))).toEqual([
      'expired',
      'expiring_soon',
      'valid',
    ]);
    expect(within(tiles[0]).getByLabelText('Expired, expiry 01/24')).toBeInTheDocument();
    expect(within(tiles[1]).getByLabelText('Expires soon, expiry 12/26')).toBeInTheDocument();
    expect(within(tiles[2]).getByLabelText('Valid, expiry 12/29')).toBeInTheDocument();
  });

  it('preserves soonest-first order from the hook', () => {
    mockCards([
      makeSummary({ id: 'first', name: 'AAA', status: 'expired' }),
      makeSummary({ id: 'second', name: 'BBB', status: 'expiring_soon' }),
      makeSummary({ id: 'third', name: 'CCC', status: 'valid' }),
    ]);
    const { container } = render(<CardsPage />);

    const text = container.textContent ?? '';
    expect(text.indexOf('AAA')).toBeLessThan(text.indexOf('BBB'));
    expect(text.indexOf('BBB')).toBeLessThan(text.indexOf('CCC'));
  });

  it('routes the import action to the wizard when AI is available', async () => {
    const user = userEvent.setup();
    mockCards([makeSummary({ id: 'card-1' })]);
    render(<CardsPage />);

    // Enabled by the default /api/ai/status handler.
    const importButton = await screen.findByRole('button', {
      name: /scan a card/i,
    });
    expect(importButton).toBeEnabled();

    await user.click(importButton);
    expect(mockNavigate).toHaveBeenCalledWith('/cards/import');
  });

  it('hides the import action entirely when AI is disabled', async () => {
    server.use(
      http.get('*/api/ai/status', () =>
        HttpResponse.json({ data: { enabled: false, features: { cardExtract: false } } }),
      ),
    );
    mockCards([makeSummary({ id: 'card-1', name: 'Everyday Card' })]);
    render(<CardsPage />);

    // The list renders regardless; only the import entry point is withheld.
    expect(await screen.findByText('Everyday Card')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /scan a card/i }),
      ).not.toBeInTheDocument(),
    );
  });

  it('hides the import action from a viewer without ai:use, even with AI on (E8.2)', async () => {
    mockCards([makeSummary({ id: 'card-1', name: 'Everyday Card' })]);
    render(<CardsPage />, { wrapperOptions: { user: mockUser } });

    expect(await screen.findByText('Everyday Card')).toBeInTheDocument();
    // Give the (enabled) status call time to land: the button must still not appear.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('button', { name: /scan a card/i })).not.toBeInTheDocument();
  });

  it('hides the import action when the status check fails', async () => {
    server.use(
      http.get('*/api/ai/status', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );
    mockCards([makeSummary({ id: 'card-1', name: 'Everyday Card' })]);
    render(<CardsPage />);

    expect(await screen.findByText('Everyday Card')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /scan a card/i }),
      ).not.toBeInTheDocument(),
    );
  });

  it('offers renewal on every card and routes to the renewal wizard', async () => {
    const user = userEvent.setup();
    mockCards([makeSummary({ id: 'card-7', name: 'Business Visa', status: 'valid' })]);
    render(<CardsPage />);

    // Not only the expiring ones: a card can be reissued after loss or fraud
    // long before its printed date.
    await user.click(screen.getByRole('button', { name: /renew business visa/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/cards/card-7/renew');
  });

  it('keeps renewal available when AI is disabled', async () => {
    // The renewal flow degrades to a manual edit with no OpenAI key, so unlike
    // the import wizard it must NOT disappear with the AI feature. Hiding it
    // here would remove a working feature from the users least able to fix it.
    server.use(
      http.get('*/api/ai/status', () =>
        HttpResponse.json({ data: { enabled: false, features: { cardExtract: false } } }),
      ),
    );
    mockCards([makeSummary({ id: 'card-7', name: 'Business Visa', status: 'expired' })]);
    render(<CardsPage />);

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /scan a card/i }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /renew business visa/i })).toBeEnabled();
  });

  it('keeps renewal available when the AI status check fails', async () => {
    server.use(
      http.get('*/api/ai/status', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );
    mockCards([makeSummary({ id: 'card-7', name: 'Business Visa' })]);
    render(<CardsPage />);

    expect(
      await screen.findByRole('button', { name: /renew business visa/i }),
    ).toBeEnabled();
  });

  it('does not let the renew button open the card detail as well', async () => {
    const user = userEvent.setup();
    mockCards([makeSummary({ id: 'card-7', name: 'Business Visa' })]);
    render(<CardsPage />);

    await user.click(screen.getByRole('button', { name: /renew business visa/i }));

    // One navigation, to the wizard — the tile's own click handler must not
    // also fire, which is why the button sits outside the CardActionArea.
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalledWith('/secrets/card-7');
  });

  it('navigates to the secret detail when a card is clicked', async () => {
    const user = userEvent.setup();
    mockCards([makeSummary({ id: 'card-42', name: 'Travel Visa' })]);
    render(<CardsPage />);

    await user.click(screen.getByText('Travel Visa'));
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

  it('filters by name', async () => {
    const user = userEvent.setup();
    mockCards([
      makeSummary({ id: 'a', name: 'Card One' }),
      makeSummary({ id: 'b', name: 'Travel Two' }),
    ]);
    render(<CardsPage />);

    await user.type(screen.getByLabelText(/search cards/i), 'travel');

    await waitFor(() => expect(screen.queryByText('Card One')).not.toBeInTheDocument());
    expect(screen.getByText('Travel Two')).toBeInTheDocument();
  });

  it.each([
    ['network', { network: 'Amex' }, 'amex'],
    ['issuing bank', { issuingBank: 'Org Beta Bank' }, 'beta'],
    ['cardholder', { cardholderName: 'Person B' }, 'person b'],
  ] as const)('filters by %s', async (_label, fields, term) => {
    const user = userEvent.setup();
    mockCards([
      makeSummary({ id: 'a', name: 'Card One' }),
      makeSummary({ id: 'b', name: 'Card Two', ...fields }),
    ]);
    render(<CardsPage />);

    await user.type(screen.getByLabelText(/search cards/i), term);

    await waitFor(() => expect(screen.queryByText('Card One')).not.toBeInTheDocument());
    expect(screen.getByText('Card Two')).toBeInTheDocument();
  });

  it('filters by the last four digits', async () => {
    const user = userEvent.setup();
    mockCards([
      makeSummary({ id: 'a', name: 'Card One', last4: '4242', maskedNumber: '•••• 4242' }),
      makeSummary({ id: 'b', name: 'Card Two', last4: '4444', maskedNumber: '•••• 4444' }),
    ]);
    render(<CardsPage />);

    await user.type(screen.getByLabelText(/search cards/i), '4444');

    await waitFor(() => expect(screen.queryByText('Card One')).not.toBeInTheDocument());
    expect(screen.getByText('Card Two')).toBeInTheDocument();
  });

  describe('card tile heading', () => {
    it('gives two cards on the same network distinguishable headings', () => {
      mockCards([
        makeSummary({ id: 'a', name: 'Personal Amex', network: 'American Express' }),
        makeSummary({ id: 'b', name: 'Business Amex', network: 'American Express' }),
      ]);
      render(<CardsPage />);

      expect(screen.getByRole('heading', { name: 'Personal Amex' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Business Amex' })).toBeInTheDocument();
      // The network is subheading detail on each tile, never a heading.
      expect(screen.queryByRole('heading', { name: 'American Express' })).not.toBeInTheDocument();
      expect(screen.getAllByText('American Express · Credit')).toHaveLength(2);
    });

    it('does not repeat the network in the subheading when the name equals it', () => {
      mockCards([
        makeSummary({ id: 'a', name: 'American Express', network: 'American Express', kind: 'Credit' }),
      ]);
      render(<CardsPage />);

      expect(screen.getAllByText(/American Express/)).toHaveLength(1);
      expect(screen.getByText('Credit')).toBeInTheDocument();
    });

    it('falls back to the network as the heading when the card has no name', () => {
      mockCards([makeSummary({ id: 'a', name: '', network: 'Mastercard', kind: 'Credit' })]);
      render(<CardsPage />);

      expect(screen.getAllByText(/Mastercard/)).toHaveLength(1);
      expect(screen.getByText('Credit')).toBeInTheDocument();
    });

    it('labels the renew button with the card name, not the network', () => {
      mockCards([makeSummary({ id: 'a', name: 'Backup Mastercard', network: 'Mastercard' })]);
      render(<CardsPage />);

      expect(screen.getByRole('button', { name: 'Renew Backup Mastercard' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Renew Mastercard' })).not.toBeInTheDocument();
    });
  });
});

describe('CardsPage — header actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers "Add manually" next to "Scan a card" once the wallet has cards', async () => {
    const user = userEvent.setup();
    mockCards([makeSummary({ id: 'card-1' })]);
    render(<CardsPage />);

    await screen.findByRole('button', { name: /scan a card/i });
    await user.click(screen.getByRole('button', { name: /add manually/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/secrets/new');
  });
});
