import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import { QuickActions } from '../../../components/home/QuickActions';

/**
 * Reach a tile the way a keyboard user would - by tabbing to it, never by
 * calling `.focus()`. If the tile is not in the tab order this fails instead of
 * quietly focusing an element the user could never have reached.
 */
async function tabTo(user: UserEvent, name: string): Promise<HTMLElement> {
  const target = screen.getByRole('button', { name });
  for (let i = 0; i < 10 && document.activeElement !== target; i += 1) {
    await user.tab();
  }
  expect(target).toHaveFocus();
  return target;
}

// Mock useNavigate from react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// The four tiles QuickActions renders today, in order. Unlike the sidebar's
// nav items, these are not permission-gated - every user sees all four.
//
// `accessibleName` is asserted rather than inferred from the visible text: the
// tile is a real button and its name has to say where it goes, so a screen
// reader user hears "Create Secret: Store a new secret, button" and not just
// two loose text nodes inside an unlabelled div.
const ACTIONS = [
  {
    title: 'Create Secret',
    description: 'Store a new secret',
    accessibleName: 'Create Secret: Store a new secret',
    path: '/secrets/new',
    iconTestId: 'AddCircleOutlineIcon',
  },
  {
    title: 'Upload Media',
    description: 'Upload files',
    accessibleName: 'Upload Media: Upload files',
    path: '/media',
    iconTestId: 'CloudUploadIcon',
  },
  {
    title: 'Browse Types',
    description: 'Manage secret types',
    accessibleName: 'Browse Types: Manage secret types',
    path: '/secret-types',
    iconTestId: 'CategoryIcon',
  },
  {
    title: 'Settings',
    description: 'Your preferences',
    accessibleName: 'Settings: Your preferences',
    path: '/settings',
    iconTestId: 'SettingsIcon',
  },
];

describe('QuickActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the "Quick Actions" section heading', () => {
      render(<QuickActions />);

      expect(screen.getByRole('heading', { name: 'Quick Actions' })).toBeInTheDocument();
    });

    it.each(ACTIONS)('should render the $title tile with its title and description', ({ title, description }) => {
      render(<QuickActions />);

      expect(screen.getByText(title)).toBeInTheDocument();
      expect(screen.getByText(description)).toBeInTheDocument();
    });

    it('should render exactly the four fixed action tiles for every user', () => {
      render(<QuickActions />);

      const titles = ACTIONS.map((action) => screen.getByText(action.title));
      expect(titles).toHaveLength(4);
    });
  });

  describe('Icons', () => {
    it.each(ACTIONS)('should render the expected icon for the $title tile', ({ title, iconTestId }) => {
      render(<QuickActions />);

      const tileTitle = screen.getByText(title);
      const tile = tileTitle.closest('.MuiCard-root');
      expect(tile).not.toBeNull();
      expect(within(tile as HTMLElement).getByTestId(iconTestId)).toBeInTheDocument();
    });
  });

  // A tile that is only a Card with an onClick is a div: it has no role, is not
  // in the tab order, and does not respond to Enter or Space. These tests fail
  // against that markup and pass only for a real button.
  describe('Accessibility', () => {
    it.each(ACTIONS)('should expose the $title tile as a button named after its destination', ({ accessibleName }) => {
      render(<QuickActions />);

      expect(screen.getByRole('button', { name: accessibleName })).toBeInTheDocument();
    });

    it('should expose exactly one button per action tile', () => {
      render(<QuickActions />);

      expect(screen.getAllByRole('button')).toHaveLength(ACTIONS.length);
    });

    it('should place every tile in the tab order, in visual order', async () => {
      const user = userEvent.setup();
      render(<QuickActions />);

      for (const { accessibleName } of ACTIONS) {
        await user.tab();
        expect(screen.getByRole('button', { name: accessibleName })).toHaveFocus();
      }
    });
  });

  describe('Navigation', () => {
    it.each(ACTIONS)('should navigate to $path when the $title tile is clicked', async ({ accessibleName, path }) => {
      const user = userEvent.setup();
      render(<QuickActions />);

      await user.click(screen.getByRole('button', { name: accessibleName }));

      expect(mockNavigate).toHaveBeenCalledWith(path);
    });

    it.each(ACTIONS)('should navigate to $path when the $title tile is activated with Enter', async ({ accessibleName, path }) => {
      const user = userEvent.setup();
      render(<QuickActions />);

      await tabTo(user, accessibleName);
      await user.keyboard('{Enter}');

      expect(mockNavigate).toHaveBeenCalledWith(path);
    });

    it.each(ACTIONS)('should navigate to $path when the $title tile is activated with Space', async ({ accessibleName, path }) => {
      const user = userEvent.setup();
      render(<QuickActions />);

      await tabTo(user, accessibleName);
      await user.keyboard('[Space]');

      expect(mockNavigate).toHaveBeenCalledWith(path);
    });

    it('should navigate using only the keyboard, from tab to activation', async () => {
      const user = userEvent.setup();
      render(<QuickActions />);

      await user.tab();
      await user.tab();
      await user.keyboard('{Enter}');

      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('/media');
    });
  });

  describe('Layout', () => {
    it('should render the tiles inside a Grid container', () => {
      const { container } = render(<QuickActions />);

      expect(container.querySelector('.MuiGrid-container')).toBeInTheDocument();
    });

    it('should render one Grid item per action tile', () => {
      const { container } = render(<QuickActions />);

      expect(container.querySelectorAll('.MuiGrid-item')).toHaveLength(ACTIONS.length);
    });
  });
});
