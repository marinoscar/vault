import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import { RecentSecretsPanel } from '../../../components/home/RecentSecretsPanel';
import { HOUR, LocationProbe, NOW, makeSecret } from './homeFixtures';

function renderPanel(props: Partial<Parameters<typeof RecentSecretsPanel>[0]> = {}) {
  return render(
    <>
      <RecentSecretsPanel status="ready" secrets={[]} error={null} onRetry={vi.fn()} canCreate now={NOW} {...props} />
      <LocationProbe />
    </>,
  );
}

describe('RecentSecretsPanel', () => {
  it('is a labelled section with a "View all" link to Secrets', () => {
    renderPanel();

    expect(screen.getByRole('region', { name: 'Recently updated' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all secrets' })).toHaveAttribute('href', '/secrets');
  });

  it('shows skeletons while loading', () => {
    renderPanel({ status: 'loading' });

    expect(screen.getByLabelText('Loading recent secrets')).toHaveAttribute('aria-busy', 'true');
  });

  it('shows the error with a retry', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    renderPanel({ status: 'error', error: 'Could not load your recent secrets.', onRetry });

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load your recent secrets.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('offers "New secret" in the empty state only to a writer', () => {
    const { unmount } = renderPanel();
    expect(screen.getByText('No secrets yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New secret' })).toHaveAttribute('href', '/secrets/new');
    unmount();

    renderPanel({ canCreate: false });
    expect(screen.getByText('No secrets yet.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New secret' })).not.toBeInTheDocument();
  });

  it('lists name, type and age, each row linking to the detail', async () => {
    const user = userEvent.setup();
    renderPanel({
      secrets: [makeSecret('s1', 'Product X admin', 0.5 * HOUR), makeSecret('s2', 'Org Alpha key', 26 * HOUR)],
    });

    const rows = within(screen.getByRole('list', { name: 'Recently updated secrets' })).getAllByRole('link');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Product X admin');
    expect(rows[0]).toHaveTextContent('Login');
    expect(rows[0]).toHaveTextContent('30m ago');
    expect(rows[1]).toHaveTextContent('1d ago');

    await user.click(rows[1]);
    expect(screen.getByTestId('location')).toHaveTextContent('/secrets/s2');
  });

  it('marks each age up as a machine-readable time', () => {
    const secret = makeSecret('s1', 'Product X admin');
    const { container } = renderPanel({ secrets: [secret] });

    expect(container.querySelector('time')).toHaveAttribute('datetime', secret.updatedAt);
  });
});
