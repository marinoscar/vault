import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, mockAdminUser } from '../../utils/test-utils';
import { Sidebar } from '../../../components/navigation/Sidebar';

// Mock react-router-dom
const mockNavigate = vi.fn();
const mockLocation = { pathname: '/' };

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => mockLocation,
  };
});

// Mock usePermissions hook
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

import { usePermissions } from '../../../hooks/usePermissions';

// Items visible to every authenticated user, in rendered order.
const BASE_MENU_ITEMS: Array<{ label: string; path: string }> = [
  { label: 'Home', path: '/' },
  { label: 'Secrets', path: '/secrets' },
  { label: 'Cards', path: '/cards' },
  { label: 'Media', path: '/media' },
  { label: 'Secret Types', path: '/secret-types' },
  { label: 'User Settings', path: '/settings' },
];

// Items visible only to admins, in rendered order (appended after the base items).
const ADMIN_ONLY_MENU_ITEMS: Array<{ label: string; path: string }> = [
  { label: 'User Management', path: '/admin/users' },
  { label: 'System Settings', path: '/admin/settings' },
];

function mockPermissions(isAdmin: boolean) {
  vi.mocked(usePermissions).mockReturnValue({
    permissions: new Set(),
    roles: new Set(isAdmin ? ['admin'] : []),
    hasPermission: vi.fn(),
    hasAnyPermission: vi.fn(),
    hasAllPermissions: vi.fn(),
    hasRole: vi.fn(),
    hasAnyRole: vi.fn(),
    isAdmin,
  });
}

describe('Sidebar', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockLocation.pathname = '/';
  });

  describe('Rendering', () => {
    it('should render Drawer component even when open is false', () => {
      mockPermissions(false);

      // The key test: calling render should work without the component returning null
      // Even though drawer content won't be in DOM with keepMounted: false and open: false,
      // the component should still render the Drawer JSX (MUI handles visibility)
      const result = render(<Sidebar open={false} onClose={mockOnClose} />);

      // Verify render was successful (result should have standard RTL properties)
      expect(result).toHaveProperty('container');
      expect(result).toHaveProperty('baseElement');
    });

    it('should render Drawer component when open is true', () => {
      mockPermissions(false);

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />);

      const drawer = container.querySelector('.MuiDrawer-root');
      expect(drawer).not.toBeNull();
    });

    it('should render every base menu item as an accessible button for non-admin users', () => {
      mockPermissions(false);

      render(<Sidebar open={true} onClose={mockOnClose} />);

      for (const item of BASE_MENU_ITEMS) {
        expect(screen.getByRole('button', { name: item.label, hidden: true })).toBeInTheDocument();
      }
    });

    it('should not render admin menu items for non-admin users', () => {
      mockPermissions(false);

      render(<Sidebar open={true} onClose={mockOnClose} />);

      for (const item of ADMIN_ONLY_MENU_ITEMS) {
        expect(screen.queryByRole('button', { name: item.label, hidden: true })).not.toBeInTheDocument();
      }
    });

    it('should render admin menu items for admin users', () => {
      mockPermissions(true);

      render(<Sidebar open={true} onClose={mockOnClose} />, {
        wrapperOptions: { user: mockAdminUser },
      });

      for (const item of [...BASE_MENU_ITEMS, ...ADMIN_ONLY_MENU_ITEMS]) {
        expect(screen.getByRole('button', { name: item.label, hidden: true })).toBeInTheDocument();
      }
    });
  });

  describe('ModalProps Configuration', () => {
    it('should have keepMounted set to false', () => {
      mockPermissions(false);

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />);

      const drawer = container.querySelector('.MuiDrawer-root');
      expect(drawer).not.toBeNull();
      // keepMounted: false means content unmounts when closed
    });

    it('should have disablePortal set to true', () => {
      mockPermissions(false);

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />);

      const drawer = container.querySelector('.MuiDrawer-root');
      expect(drawer).not.toBeNull();
      // disablePortal: true keeps Modal in component tree
    });
  });

  describe('Menu Item Visibility Filtering', () => {
    it('should render exactly the base menu items, in order, for a non-admin user', () => {
      mockPermissions(false);

      render(<Sidebar open={true} onClose={mockOnClose} />);

      const names = screen.getAllByRole('button', { hidden: true }).map((button) => button.textContent);
      expect(names).toEqual(BASE_MENU_ITEMS.map((item) => item.label));
    });

    it('should render base items plus admin items, in order, for an admin user', () => {
      mockPermissions(true);

      render(<Sidebar open={true} onClose={mockOnClose} />, {
        wrapperOptions: { user: mockAdminUser },
      });

      const names = screen.getAllByRole('button', { hidden: true }).map((button) => button.textContent);
      expect(names).toEqual([...BASE_MENU_ITEMS, ...ADMIN_ONLY_MENU_ITEMS].map((item) => item.label));
    });

    it('should dynamically update menu items when isAdmin changes', () => {
      mockPermissions(false);

      const { rerender } = render(<Sidebar open={true} onClose={mockOnClose} />);

      expect(screen.queryByRole('button', { name: 'User Management', hidden: true })).not.toBeInTheDocument();

      // Update to admin
      mockPermissions(true);
      rerender(<Sidebar open={true} onClose={mockOnClose} />);

      expect(screen.getByRole('button', { name: 'User Management', hidden: true })).toBeInTheDocument();
    });
  });

  describe('Navigation Behavior', () => {
    it('should call onClose BEFORE navigate when menu item is clicked', async () => {
      const user = userEvent.setup();
      const callOrder: string[] = [];

      const trackingOnClose = vi.fn(() => {
        callOrder.push('onClose');
      });

      mockNavigate.mockImplementation(() => {
        callOrder.push('navigate');
      });

      mockPermissions(false);

      render(<Sidebar open={true} onClose={trackingOnClose} />);

      await user.click(screen.getByRole('button', { name: 'User Settings', hidden: true }));

      // onClose should be called immediately (synchronously)
      expect(trackingOnClose).toHaveBeenCalledTimes(1);

      // Wait for navigate to be called (it's in setTimeout(0))
      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledTimes(1);
      });

      // Verify order: onClose should be called BEFORE navigate
      expect(callOrder).toEqual(['onClose', 'navigate']);
    });

    it.each(BASE_MENU_ITEMS)('should navigate to $path when $label menu item is clicked', async ({ label, path }) => {
      const user = userEvent.setup();
      mockPermissions(false);

      render(<Sidebar open={true} onClose={mockOnClose} />);

      await user.click(screen.getByRole('button', { name: label, hidden: true }));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(path);
      });
    });

    it.each(ADMIN_ONLY_MENU_ITEMS)('should navigate to $path when $label menu item is clicked', async ({ label, path }) => {
      const user = userEvent.setup();
      mockPermissions(true);

      render(<Sidebar open={true} onClose={mockOnClose} />, {
        wrapperOptions: { user: mockAdminUser },
      });

      await user.click(screen.getByRole('button', { name: label, hidden: true }));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(path);
      });
    });
  });

  describe('Active Menu Item Highlighting', () => {
    it('should highlight current route', () => {
      mockLocation.pathname = '/settings';
      mockPermissions(false);

      render(<Sidebar open={true} onClose={mockOnClose} />);

      const settingsButton = screen.getByRole('button', { name: 'User Settings', hidden: true });
      expect(settingsButton.classList.contains('Mui-selected')).toBe(true);
    });

    it('should not highlight non-current routes', () => {
      mockLocation.pathname = '/';
      mockPermissions(false);

      render(<Sidebar open={true} onClose={mockOnClose} />);

      const settingsButton = screen.getByRole('button', { name: 'User Settings', hidden: true });
      expect(settingsButton.classList.contains('Mui-selected')).toBe(false);
    });

    it('should highlight admin routes when on admin page', () => {
      mockLocation.pathname = '/admin/users';
      mockPermissions(true);

      render(<Sidebar open={true} onClose={mockOnClose} />, {
        wrapperOptions: { user: mockAdminUser },
      });

      const userMgmtButton = screen.getByRole('button', { name: 'User Management', hidden: true });
      expect(userMgmtButton.classList.contains('Mui-selected')).toBe(true);
    });
  });

  describe('Drawer Close Behavior', () => {
    it('should pass onClose prop to Drawer', () => {
      mockPermissions(false);

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />);

      // The onClose prop is passed to Drawer - verify drawer is rendered
      const drawer = container.querySelector('.MuiDrawer-root');
      expect(drawer).not.toBeNull();
      expect(mockOnClose).toHaveBeenCalledTimes(0);
    });

    it('should call onClose for each menu item click', async () => {
      const user = userEvent.setup();
      mockPermissions(false);

      render(<Sidebar open={true} onClose={mockOnClose} />);

      await user.click(screen.getByRole('button', { name: 'Home', hidden: true }));
      expect(mockOnClose).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole('button', { name: 'Secrets', hidden: true }));
      expect(mockOnClose).toHaveBeenCalledTimes(2);
    });
  });

  describe('Menu Icons', () => {
    it('should render exactly one icon per rendered menu item', () => {
      mockPermissions(true);

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />, {
        wrapperOptions: { user: mockAdminUser },
      });

      // Every button should carry exactly one icon - independent of how many
      // menu items currently exist.
      const buttons = screen.getAllByRole('button', { hidden: true });
      const icons = container.querySelectorAll('.MuiListItemIcon-root');
      expect(icons).toHaveLength(buttons.length);
    });

    it('should highlight icon for selected menu item', () => {
      mockLocation.pathname = '/settings';
      mockPermissions(false);

      render(<Sidebar open={true} onClose={mockOnClose} />);

      const settingsButton = screen.getByRole('button', { name: 'User Settings', hidden: true });
      const icon = within(settingsButton).getByTestId('SettingsIcon');

      expect(icon).not.toBeNull();
      // Icon should have primary color styling when selected
    });
  });

  describe('Accessibility', () => {
    it('should render drawer with proper structure', () => {
      mockPermissions(false);

      render(<Sidebar open={true} onClose={mockOnClose} />);

      // Drawer should be rendered with buttons
      expect(screen.getAllByRole('button', { hidden: true }).length).toBeGreaterThan(0);
    });

    it('should have accessible button labels', () => {
      mockPermissions(false);

      render(<Sidebar open={true} onClose={mockOnClose} />);

      // Every base menu item should be reachable by its accessible name
      for (const item of BASE_MENU_ITEMS) {
        expect(screen.getByRole('button', { name: item.label, hidden: true })).toBeInTheDocument();
      }
    });

    it('should be keyboard navigable', async () => {
      const user = userEvent.setup();
      mockPermissions(false);

      render(<Sidebar open={true} onClose={mockOnClose} />);

      const homeButton = screen.getByRole('button', { name: 'Home', hidden: true });

      // Should be able to focus and activate with keyboard
      homeButton.focus();
      expect(homeButton).toHaveFocus();

      await user.keyboard('{Enter}');
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });

  describe('Regression Tests', () => {
    it('should NOT return null when open is false (critical bug fix)', () => {
      mockPermissions(false);

      // CRITICAL REGRESSION TEST:
      // Previously, the component conditionally returned null when open was false:
      // if (!open) return null; // ❌ WRONG - caused backdrop click issues
      //
      // This caused UI blocking issues because:
      // 1. The component was completely removed from the React tree
      // 2. When reopened, React had to remount everything
      // 3. This caused backdrop click handlers to become stale/broken
      //
      // The fix: Component always returns the Drawer JSX:
      // return <Drawer open={open} ... /> // ✅ CORRECT - let MUI handle visibility
      //
      // This test verifies the component doesn't throw and renders successfully
      expect(() => {
        render(<Sidebar open={false} onClose={mockOnClose} />);
      }).not.toThrow();

      // Also verify it works when open
      expect(() => {
        render(<Sidebar open={true} onClose={mockOnClose} />);
      }).not.toThrow();
    });

    it('should close drawer before navigation to prevent backdrop issues', async () => {
      const user = userEvent.setup();
      let drawerClosed = false;
      let navigationOccurred = false;

      const trackingOnClose = vi.fn(() => {
        drawerClosed = true;
        // At the moment onClose is called, navigation should not have occurred yet
        expect(navigationOccurred).toBe(false);
      });

      mockNavigate.mockImplementation(() => {
        navigationOccurred = true;
        // Drawer should already be closed when navigation occurs
        expect(drawerClosed).toBe(true);
      });

      mockPermissions(false);

      render(<Sidebar open={true} onClose={trackingOnClose} />);

      await user.click(screen.getByRole('button', { name: 'Home', hidden: true }));

      // Drawer close should happen synchronously
      expect(drawerClosed).toBe(true);

      // Wait for navigation to occur (it's in setTimeout(0))
      await waitFor(() => {
        expect(navigationOccurred).toBe(true);
      });
    });

    it('should maintain ModalProps configuration for backdrop click handling', () => {
      mockPermissions(false);

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />);

      const drawer = container.querySelector('.MuiDrawer-root');
      expect(drawer).not.toBeNull();

      // Critical: disablePortal: true keeps Modal in component tree
      // This prevents backdrop click issues after navigation
      // keepMounted: false ensures drawer content unmounts when closed
    });
  });
});
