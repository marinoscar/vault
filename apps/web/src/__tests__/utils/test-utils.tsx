import { ReactElement, ReactNode } from 'react';
import { render, RenderOptions, RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { ShellRoot } from '@marinoscar/platform-web/shell/ui';
import { ShellPreferencesProvider } from '@marinoscar/platform-web/shell/headless';

// Vault's AuthContext, re-published to the platform's identity context the
// shell reads (the same bridge App.tsx mounts), under the Vault themes.
import { AuthContext } from '../../contexts/AuthContext';
import { PlatformAuthBridge } from '../../platform/PlatformAuthBridge';
import { shellPreferencesPort } from '../../platform/shellPreferences';
import { VAULT_THEMES } from '../../theme';
import type { AuthProvider as AuthProviderType } from '../../types';

interface WrapperOptions {
  route?: string;
  theme?: 'light' | 'dark';
  authenticated?: boolean;
  user?: MockUser | null;
  isLoading?: boolean;
  providers?: AuthProviderType[];
}

export interface MockUser {
  id: string;
  email: string;
  displayName: string | null;
  profileImageUrl: string | null;
  roles: { name: string }[];
  permissions: string[];
  isActive: boolean;
  createdAt: string;
}

export const mockUser: MockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  displayName: 'Test User',
  profileImageUrl: null,
  roles: [{ name: 'viewer' }],
  permissions: ['user_settings:read', 'user_settings:write'],
  isActive: true,
  createdAt: new Date().toISOString(),
};

export const mockAdminUser: MockUser = {
  id: 'admin-user-id',
  email: 'admin@example.com',
  displayName: 'Admin User',
  profileImageUrl: null,
  roles: [{ name: 'admin' }],
  permissions: [
    'user_settings:read',
    'user_settings:write',
    'system_settings:read',
    'system_settings:write',
    'users:read',
    'users:write',
    'rbac:manage',
  ],
  isActive: true,
  createdAt: new Date().toISOString(),
};

// Default mock providers
const defaultMockProviders: AuthProviderType[] = [
  { name: 'google', authUrl: '/api/auth/google' },
];

// Mock Auth Provider for testing
interface MockAuthProviderProps {
  children: ReactNode;
  authenticated?: boolean;
  user?: MockUser | null;
  isLoading?: boolean;
  providers?: AuthProviderType[];
}

function MockAuthProvider({
  children,
  authenticated = true,
  user = mockUser,
  isLoading = false,
  providers = defaultMockProviders,
}: MockAuthProviderProps) {
  const contextValue = {
    user: authenticated ? user : null,
    isLoading,
    isAuthenticated: authenticated,
    providers,
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    refreshUser: vi.fn().mockResolvedValue(undefined),
  };

  return (
    <AuthContext.Provider value={contextValue}>
      <PlatformAuthBridge>
        <ShellPreferencesProvider port={shellPreferencesPort}>{children}</ShellPreferencesProvider>
      </PlatformAuthBridge>
    </AuthContext.Provider>
  );
}

function createWrapper(options: WrapperOptions = {}) {
  const {
    route = '/',
    authenticated = true,
    user = mockUser,
    isLoading = false,
    providers = defaultMockProviders,
  } = options;

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[route]}>
        <ShellRoot themes={VAULT_THEMES}>
          <MockAuthProvider
            authenticated={authenticated}
            user={user}
            isLoading={isLoading}
            providers={providers}
          >
            {children}
          </MockAuthProvider>
        </ShellRoot>
      </MemoryRouter>
    );
  };
}

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  wrapperOptions?: WrapperOptions;
}

export function renderWithProviders(
  ui: ReactElement,
  options: CustomRenderOptions = {},
): RenderResult {
  const { wrapperOptions, ...renderOptions } = options;

  return render(ui, {
    wrapper: createWrapper(wrapperOptions),
    ...renderOptions,
  });
}

// Re-export everything from testing library
export * from '@testing-library/react';
export { renderWithProviders as render };
