import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import { QuickActions } from '../../../components/home/QuickActions';

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
const ACTIONS = [
  { title: 'Create Secret', description: 'Store a new secret', path: '/secrets/new', iconTestId: 'AddCircleOutlineIcon' },
  { title: 'Upload Media', description: 'Upload files', path: '/media', iconTestId: 'CloudUploadIcon' },
  { title: 'Browse Types', description: 'Manage secret types', path: '/secret-types', iconTestId: 'CategoryIcon' },
  { title: 'Settings', description: 'Your preferences', path: '/settings', iconTestId: 'SettingsIcon' },
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

  describe('Navigation', () => {
    it.each(ACTIONS)('should navigate to $path when the $title tile is clicked', async ({ title, path }) => {
      const user = userEvent.setup();
      render(<QuickActions />);

      await user.click(screen.getByText(title));

      expect(mockNavigate).toHaveBeenCalledWith(path);
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
