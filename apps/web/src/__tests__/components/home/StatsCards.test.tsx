import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import { StatsCards } from '../../../components/home/StatsCards';

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

const COUNTS = { totalSecrets: 7, totalFolders: 3, totalTypes: 12 };

// Every stat tile navigates, so every one of them is genuinely a button. The
// name has to carry the destination: "7 / Secrets" on its own never says the
// tile is something you can go through.
const STATS = [
  { label: 'Secrets', count: COUNTS.totalSecrets, accessibleName: 'View Secrets (7)', path: '/secrets' },
  { label: 'Media Folders', count: COUNTS.totalFolders, accessibleName: 'View Media Folders (3)', path: '/media' },
  { label: 'Secret Types', count: COUNTS.totalTypes, accessibleName: 'View Secret Types (12)', path: '/secret-types' },
];

function renderStats(overrides: Partial<Parameters<typeof StatsCards>[0]> = {}) {
  return render(<StatsCards {...COUNTS} isLoading={false} {...overrides} />);
}

describe('StatsCards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it.each(STATS)('should render the $label tile with its count', ({ label, count }) => {
      renderStats();

      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByText(String(count))).toBeInTheDocument();
    });

    it('should render skeletons instead of counts while loading', () => {
      const { container } = renderStats({ isLoading: true });

      expect(container.querySelectorAll('.MuiSkeleton-root').length).toBeGreaterThan(0);
      expect(screen.queryByText(String(COUNTS.totalSecrets))).not.toBeInTheDocument();
    });
  });

  // A Card with a bare onClick is a div: no role, not tab-reachable, deaf to
  // Enter and Space. These tests fail against that markup by construction.
  describe('Accessibility', () => {
    it.each(STATS)('should expose the $label tile as a button named after its destination', ({ accessibleName }) => {
      renderStats();

      expect(screen.getByRole('button', { name: accessibleName })).toBeInTheDocument();
    });

    it('should expose exactly one button per stat tile', () => {
      renderStats();

      expect(screen.getAllByRole('button')).toHaveLength(STATS.length);
    });

    it('should place every tile in the tab order, in visual order', async () => {
      const user = userEvent.setup();
      renderStats();

      for (const { accessibleName } of STATS) {
        await user.tab();
        expect(screen.getByRole('button', { name: accessibleName })).toHaveFocus();
      }
    });

    it('should still name each tile while counts are loading', () => {
      renderStats({ isLoading: true });

      for (const { label } of STATS) {
        expect(screen.getByRole('button', { name: `View ${label}` })).toBeInTheDocument();
      }
    });
  });

  describe('Navigation', () => {
    it.each(STATS)('should navigate to $path when the $label tile is clicked', async ({ accessibleName, path }) => {
      const user = userEvent.setup();
      renderStats();

      await user.click(screen.getByRole('button', { name: accessibleName }));

      expect(mockNavigate).toHaveBeenCalledWith(path);
    });

    it.each(STATS)('should navigate to $path when the $label tile is activated with Enter', async ({ accessibleName, path }) => {
      const user = userEvent.setup();
      renderStats();

      await tabTo(user, accessibleName);
      await user.keyboard('{Enter}');

      expect(mockNavigate).toHaveBeenCalledWith(path);
    });

    it.each(STATS)('should navigate to $path when the $label tile is activated with Space', async ({ accessibleName, path }) => {
      const user = userEvent.setup();
      renderStats();

      await tabTo(user, accessibleName);
      await user.keyboard('[Space]');

      expect(mockNavigate).toHaveBeenCalledWith(path);
    });

    it('should navigate using only the keyboard, from tab to activation', async () => {
      const user = userEvent.setup();
      renderStats();

      await user.tab();
      await user.keyboard('{Enter}');

      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('/secrets');
    });
  });

  describe('Layout', () => {
    it('should render one Grid item per stat tile', () => {
      const { container } = renderStats();

      expect(container.querySelectorAll('.MuiGrid-item')).toHaveLength(STATS.length);
    });
  });
});
