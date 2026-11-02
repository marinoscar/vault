import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import { StatsRow, type StatTile } from '../../../components/home/StatsRow';
import { LocationProbe } from './homeFixtures';

const TILES: StatTile[] = [
  { key: 'secrets', label: 'Secrets', value: 37, status: 'ready', to: '/secrets' },
  { key: 'cards', label: 'Cards', value: 4, status: 'ready', to: '/cards' },
  { key: 'attention', label: 'Need attention', value: 2, status: 'ready', to: '/cards?filter=attention', emphasize: true },
];

function renderRow(tiles: StatTile[] = TILES) {
  return render(
    <>
      <StatsRow tiles={tiles} />
      <LocationProbe />
    </>,
  );
}

describe('StatsRow', () => {
  it('renders nothing without tiles', () => {
    const { container } = renderRow([]);
    expect(container.querySelector('[data-testid="home-stats"]')).toBeNull();
  });

  it('renders each count as a link named after its destination and count', () => {
    renderRow();

    expect(screen.getByRole('region', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Secrets (37)' })).toHaveAttribute('href', '/secrets');
    expect(screen.getByRole('link', { name: 'View Cards (4)' })).toHaveAttribute('href', '/cards');
    expect(screen.getByRole('link', { name: 'View Need attention (2)' })).toHaveAttribute(
      'href',
      '/cards?filter=attention',
    );
  });

  it('shows a skeleton per loading tile and an em dash for a failed one', () => {
    renderRow([
      { key: 'secrets', label: 'Secrets', value: null, status: 'loading', to: '/secrets' },
      { key: 'media', label: 'Media folders', value: null, status: 'error', to: '/media' },
    ]);

    expect(screen.getByTestId('stat-skeleton-secrets')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Secrets' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Media folders' })).toHaveTextContent('—');
  });

  it('is reachable and followable with the keyboard alone, in visual order', async () => {
    const user = userEvent.setup();
    renderRow();

    await user.tab();
    expect(screen.getByRole('link', { name: 'View Secrets (37)' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'View Cards (4)' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent('/cards');
  });
});
