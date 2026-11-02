import { ReactElement, ReactNode } from 'react';
import { render, RenderOptions, RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { ShellRoot } from '@marinoscar/platform-web/shell/ui';

// The platform's identity context with a fixed session (instead of the
// packaged `AuthProvider`, which would probe `/auth/refresh`), then what the
// host mounts around these pages (apps/web/src/App.tsx): a platform host over
// the configured Vault client, under the Vault themes. Like the host, no
// preferences provider: the rail and the tables keep their state in
// `/user-settings` through the platform host (the MSW handlers answer it).
// The host's own bindings are not imported: a package never depends on its host.
import { AuthContext, useAuth, usePermissions } from '@marinoscar/platform-web/identity/headless';
import type {
  AuthContextValue,
  AuthProviderInfo as AuthProviderType,
} from '@marinoscar/platform-web/identity/headless';
import { PlatformHostProvider, createPlatformApiClient } from '@marinoscar/platform-web/core';
import type { PlatformWebHost } from '@marinoscar/platform-web/core';
import { useMemo } from 'react';
import { getVaultHttp } from '../../src/core/headless/http.js';
import { VAULT_THEMES } from '../../src/brand/theme.js';

/** The packaged platform client over the configured Vault client (test/setup.ts). */
const testPlatformApi = createPlatformApiClient(getVaultHttp());

/** A platform host as the app's binding builds it, minus the AI feature. */
function TestPlatformHostProvider({ children }: { children: ReactNode }) {
  const { user, refreshUser } = useAuth();
  const { hasPermission } = usePermissions();
  const host = useMemo<PlatformWebHost>(
    () => ({
      api: testPlatformApi,
      viewer: {
        userId: user?.id ?? null,
        email: user?.email ?? null,
        hasPermission,
        isFeatureEnabled: () => false,
        refresh: refreshUser,
      },
    }),
    [user?.id, user?.email, hasPermission, refreshUser],
  );
  return <PlatformHostProvider host={host}>{children}</PlatformHostProvider>;
}

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
    // The platform AI slice's admin pair (E8.2): the seeded `admin` role holds it.
    'ai_config:read',
    'ai_config:write',
  ],
  isActive: true,
  createdAt: new Date().toISOString(),
};

/**
 * The `AuthContextValue` fields a test that mocks `useAuth` rarely cares
 * about (no organization switching in Vault's single-organization mode).
 */
export const AUTH_CONTEXT_DEFAULTS = {
  sessionExpired: false,
  setAccessToken: vi.fn(),
  activeOrg: null,
  memberships: [],
  switchOrg: vi.fn().mockResolvedValue(undefined),
  mode: 'server',
} satisfies Partial<AuthContextValue>;

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
  const contextValue: AuthContextValue = {
    user: authenticated ? user : null,
    isLoading,
    isAuthenticated: authenticated,
    providers,
    sessionExpired: false,
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    refreshUser: vi.fn().mockResolvedValue(undefined),
    setAccessToken: vi.fn(),
    activeOrg: null,
    memberships: [],
    switchOrg: vi.fn().mockResolvedValue(undefined),
    mode: 'server',
  };

  return (
    <AuthContext.Provider value={contextValue}>
      <TestPlatformHostProvider>{children}</TestPlatformHostProvider>
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
