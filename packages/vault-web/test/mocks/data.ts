import type { AuthProviderInfo } from '@marinoscar/platform-web/identity/headless';
import type { SecretDetail, SecretType } from '../../src/core/headless/types.js';
import { User, UserSettings, SystemSettings } from '../../src/core/headless/types.js';

export const mockUsers: User[] = [
  {
    id: 'user-1',
    email: 'viewer@example.com',
    displayName: 'Viewer User',
    profileImageUrl: null,
    roles: [{ name: 'viewer' }],
    permissions: ['user_settings:read'],
    isActive: true,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'user-2',
    email: 'contributor@example.com',
    displayName: 'Contributor User',
    profileImageUrl: 'https://example.com/photo.jpg',
    roles: [{ name: 'contributor' }],
    permissions: ['user_settings:read', 'user_settings:write'],
    isActive: true,
    createdAt: '2024-01-02T00:00:00.000Z',
  },
  {
    id: 'user-3',
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
    createdAt: '2024-01-03T00:00:00.000Z',
  },
  {
    id: 'user-4',
    email: 'inactive@example.com',
    displayName: 'Inactive User',
    profileImageUrl: null,
    roles: [{ name: 'viewer' }],
    permissions: [],
    isActive: false,
    createdAt: '2024-01-04T00:00:00.000Z',
  },
];

export const mockUserSettings: UserSettings = {
  theme: 'system',
  profile: {
    displayName: undefined,
    useProviderImage: true,
    customImageUrl: null,
  },
  updatedAt: '2024-01-01T00:00:00.000Z',
  version: 1,
};

export const mockSystemSettings: SystemSettings = {
  ui: {
    allowUserThemeOverride: true,
  },
  features: {},
  ai: null,
  updatedAt: '2024-01-01T00:00:00.000Z',
  updatedBy: null,
  version: 1,
};

export const mockAuthProviders: AuthProviderInfo[] = [
  {
    name: 'google',
    authUrl: '/api/auth/google',
  },
];

// Helper to create variations
export function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: `user-${Date.now()}`,
    email: `user-${Date.now()}@example.com`,
    displayName: 'Mock User',
    profileImageUrl: null,
    roles: [{ name: 'viewer' }],
    permissions: ['user_settings:read'],
    isActive: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

export function createMockUserSettings(
  overrides: Partial<UserSettings> = {},
): UserSettings {
  return {
    ...mockUserSettings,
    ...overrides,
  };
}

/**
 * A fixture system type with the field model of issue #207: a `last4` mask, a
 * `country` field, a `multiline` field and a `keyvalue` field. Invented
 * values only (Person A, X1234567, the UTO specimen state).
 */
export const mockDocumentType: SecretType = {
  id: 'type-document-fixture',
  name: 'Document Fixture',
  description: 'A test-only type exercising keyvalue, country, multiline and last4',
  icon: 'Badge',
  isSystem: true,
  allowAttachments: false,
  createdAt: '2026-01-01T00:00:00Z',
  fields: [
    { name: 'holder', label: 'Holder', type: 'string', required: true, sensitive: false },
    { name: 'number', label: 'Document number', type: 'string', required: true, sensitive: true, mask: 'last4' },
    { name: 'country', label: 'Issuing country', type: 'string', required: false, sensitive: false, format: 'country' },
    { name: 'remarks', label: 'Remarks', type: 'string', required: false, sensitive: false, format: 'multiline' },
    { name: 'details', label: 'Details', type: 'keyvalue', required: false, sensitive: false },
  ],
};

/** A secret of {@link mockDocumentType}. */
export const mockDocumentSecret: SecretDetail = {
  id: 'secret-document-fixture',
  name: 'Person A document',
  description: null,
  type: mockDocumentType,
  currentVersion: 2,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-02-01T00:00:00Z',
  agentAccess: 'none',
  agentAccessChangedAt: null,
  values: {
    holder: 'Person A',
    number: 'X1234567',
    country: 'UTO',
    remarks: 'Line one\nLine two',
    details: [
      { key: 'class', label: 'Class', value: 'B', sensitive: false },
      { key: 'pin', label: 'PIN', value: '0000-placeholder', sensitive: true },
    ],
  },
  createdBy: null,
  attachments: [],
};
