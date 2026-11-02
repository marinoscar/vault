import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import { QuickActions } from '../../../components/home/QuickActions';
import { LocationProbe } from './homeFixtures';

const ALL = { canCreateSecret: true, canScanCard: true, canBackUp: true };

const ACTIONS = [
  { name: 'New secret', path: '/secrets/new', icon: 'AddIcon' },
  { name: 'Scan a card', path: '/cards/import', icon: 'DocumentScannerOutlinedIcon' },
  { name: 'Back up now', path: '/settings', icon: 'BackupIcon' },
];

function renderActions(props: Partial<Parameters<typeof QuickActions>[0]> = {}) {
  return render(
    <>
      <QuickActions {...ALL} {...props} />
      <LocationProbe />
    </>,
  );
}

describe('QuickActions', () => {
  it('is a navigation landmark named "Quick actions"', () => {
    renderActions();
    expect(screen.getByRole('navigation', { name: 'Quick actions' })).toBeInTheDocument();
  });

  it.each(ACTIONS)('renders "$name" as a link to $path with its icon', ({ name, path, icon }) => {
    renderActions();

    const link = screen.getByRole('link', { name });
    expect(link).toHaveAttribute('href', path);
    expect(within(link).getByTestId(icon)).toBeInTheDocument();
  });

  it('renders the actions in a fixed order', () => {
    renderActions();
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual(ACTIONS.map((a) => a.name));
  });

  it.each([
    [{ canCreateSecret: false }, ['Scan a card', 'Back up now']],
    [{ canScanCard: false }, ['New secret', 'Back up now']],
    [{ canBackUp: false }, ['New secret', 'Scan a card']],
    [{ canCreateSecret: false, canScanCard: false }, ['Back up now']],
  ])('shows only the permitted actions for %o', (props, expected) => {
    renderActions(props);
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual(expected);
  });

  it('renders nothing when no action is permitted', () => {
    renderActions({ canCreateSecret: false, canScanCard: false, canBackUp: false });
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('places every action in the tab order and follows it with Enter', async () => {
    const user = userEvent.setup();
    renderActions();

    for (const { name } of ACTIONS) {
      await user.tab();
      expect(screen.getByRole('link', { name })).toHaveFocus();
    }
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent('/settings');
  });

  it('follows an action on click', async () => {
    const user = userEvent.setup();
    renderActions();

    await user.click(screen.getByRole('link', { name: 'Scan a card' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/cards/import');
  });
});
