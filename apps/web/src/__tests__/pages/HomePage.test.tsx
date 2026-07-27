import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { render, mockUser } from '../utils/test-utils';
import HomePage from '../../pages/HomePage';
import type { SecretListItem, SecretType, MediaFolder } from '../../types';

// HomePage delegates all of its data to these three hooks and simply wires
// their state into child components. Mocking them keeps these tests focused
// on HomePage's own composition/wiring logic rather than re-testing the
// hooks' internal fetch behaviour (or requiring a real network layer).
vi.mock('../../hooks/useSecrets', () => ({ useSecrets: vi.fn() }));
vi.mock('../../hooks/useSecretTypes', () => ({ useSecretTypes: vi.fn() }));
vi.mock('../../hooks/useMediaFolders', () => ({ useMediaFolders: vi.fn() }));

import { useSecrets } from '../../hooks/useSecrets';
import { useSecretTypes } from '../../hooks/useSecretTypes';
import { useMediaFolders } from '../../hooks/useMediaFolders';

const mockFetchSecrets = vi.fn();
const mockFetchTypes = vi.fn();
const mockFetchFolders = vi.fn();

const mockSecretType: SecretType = {
  id: 'type-1',
  name: 'Password',
  description: null,
  icon: 'Key',
  fields: [],
  allowAttachments: false,
  isSystem: true,
  createdAt: '2024-01-01T00:00:00.000Z',
};

const mockSecret: SecretListItem = {
  id: 'secret-1',
  name: 'GitHub',
  description: 'Personal access token',
  type: mockSecretType,
  currentVersion: 2,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const mockFolder: MediaFolder = {
  id: 'folder-1',
  name: 'Receipts',
  userId: mockUser.id,
  fileCount: 3,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

function mockData(overrides: {
  secrets?: SecretListItem[];
  totalSecrets?: number;
  secretsLoading?: boolean;
  types?: SecretType[];
  typesLoading?: boolean;
  folders?: MediaFolder[];
  totalFolders?: number;
  foldersLoading?: boolean;
} = {}) {
  vi.mocked(useSecrets).mockReturnValue({
    secrets: overrides.secrets ?? [],
    totalItems: overrides.totalSecrets ?? (overrides.secrets?.length ?? 0),
    page: 1,
    pageSize: 5,
    totalPages: 1,
    isLoading: overrides.secretsLoading ?? false,
    error: null,
    fetchSecrets: mockFetchSecrets,
    createSecret: vi.fn(),
    deleteSecret: vi.fn(),
  });

  vi.mocked(useSecretTypes).mockReturnValue({
    types: overrides.types ?? [],
    isLoading: overrides.typesLoading ?? false,
    error: null,
    fetchTypes: mockFetchTypes,
    createType: vi.fn(),
    updateType: vi.fn(),
    deleteType: vi.fn(),
  });

  vi.mocked(useMediaFolders).mockReturnValue({
    folders: overrides.folders ?? [],
    totalItems: overrides.totalFolders ?? (overrides.folders?.length ?? 0),
    page: 1,
    pageSize: 5,
    totalPages: 1,
    isLoading: overrides.foldersLoading ?? false,
    error: null,
    fetchFolders: mockFetchFolders,
    createFolder: vi.fn(),
    deleteFolder: vi.fn(),
    renameFolder: vi.fn(),
  });
}

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockData();

    // WelcomeHeader's greeting depends on the wall-clock hour; pin it so the
    // heading text is deterministic across CI/local runs.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 1, 10, 0, 0)); // 10:00 -> "Good morning"
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Greeting header', () => {
    it("should render the greeting with the user's display name", () => {
      render(<HomePage />, { wrapperOptions: { authenticated: true, user: mockUser } });

      expect(
        screen.getByRole('heading', { level: 1, name: `Good morning, ${mockUser.displayName}` }),
      ).toBeInTheDocument();
    });

    it('should render the greeting without a trailing name when displayName is null', () => {
      render(<HomePage />, {
        wrapperOptions: { authenticated: true, user: { ...mockUser, displayName: null } },
      });

      expect(screen.getByRole('heading', { level: 1, name: 'Good morning' })).toBeInTheDocument();
    });

    it('should render the greeting without a name when there is no user', () => {
      render(<HomePage />, { wrapperOptions: { authenticated: true, user: null } });

      expect(screen.getByRole('heading', { level: 1, name: 'Good morning' })).toBeInTheDocument();
    });

    it('should render the vault subtitle', () => {
      render(<HomePage />);

      expect(screen.getByText("Here's what's happening in your vault")).toBeInTheDocument();
    });
  });

  describe('Data fetching on mount', () => {
    it('should fetch the 5 most recently updated secrets', () => {
      render(<HomePage />);

      expect(mockFetchSecrets).toHaveBeenCalledWith({
        pageSize: 5,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      });
    });

    it('should fetch secret types', () => {
      render(<HomePage />);

      expect(mockFetchTypes).toHaveBeenCalledWith();
    });

    it('should fetch the 5 most recently created media folders', () => {
      render(<HomePage />);

      expect(mockFetchFolders).toHaveBeenCalledWith({
        pageSize: 5,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });
    });
  });

  describe('Composition', () => {
    it('should render all dashboard sections', () => {
      render(<HomePage />);

      // Each section renders its title as a heading; query by role/name so
      // this doesn't collide with the "Secret Types" stat label below.
      expect(screen.getByRole('heading', { name: 'Recent Secrets' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Recent Media' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Quick Actions' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Secret Types' })).toBeInTheDocument();
    });

    it('should render inside a max-width lg Container', () => {
      const { container } = render(<HomePage />);

      expect(container.querySelector('.MuiContainer-maxWidthLg')).toBeInTheDocument();
    });
  });

  describe('Stats summary', () => {
    it('should display the total secrets, media folders, and secret type counts from the hooks', () => {
      mockData({
        totalSecrets: 12,
        folders: [mockFolder],
        totalFolders: 7,
        types: [mockSecretType, { ...mockSecretType, id: 'type-2', name: 'API Key' }],
      });

      render(<HomePage />);

      expect(screen.getByText('12')).toBeInTheDocument();
      expect(screen.getByText('Secrets')).toBeInTheDocument();
      expect(screen.getByText('7')).toBeInTheDocument();
      expect(screen.getByText('Media Folders')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
      // "Secret Types" also labels this stat AND titles the SecretTypesOverview
      // card below, so two matches are expected here.
      expect(screen.getAllByText('Secret Types')).toHaveLength(2);
    });

    it('should render skeleton placeholders instead of counts while any source is still loading', () => {
      mockData({ secretsLoading: true });

      const { container } = render(<HomePage />);

      expect(container.querySelectorAll('.MuiSkeleton-root').length).toBeGreaterThan(0);
      expect(screen.queryByText('Secrets')).not.toBeInTheDocument();
    });
  });

  describe('Recent Secrets', () => {
    it("should list the current user's recent secrets", () => {
      mockData({ secrets: [mockSecret] });

      render(<HomePage />);

      expect(screen.getByText('GitHub')).toBeInTheDocument();
      expect(screen.getByText('Personal access token')).toBeInTheDocument();
    });

    it('should show an empty state when there are no secrets yet', () => {
      render(<HomePage />);

      expect(screen.getByText('No secrets yet')).toBeInTheDocument();
    });
  });

  describe('Recent Media', () => {
    it('should list recent media folders', () => {
      mockData({ folders: [mockFolder] });

      render(<HomePage />);

      expect(screen.getByText('Receipts')).toBeInTheDocument();
      expect(screen.getByText('3 files')).toBeInTheDocument();
    });

    it('should show an empty state when there are no media folders yet', () => {
      render(<HomePage />);

      expect(screen.getByText('No media folders yet')).toBeInTheDocument();
    });
  });

  describe('Secret Types Overview', () => {
    it('should list secret type chips', () => {
      mockData({ types: [mockSecretType] });

      render(<HomePage />);

      expect(screen.getByText('Password')).toBeInTheDocument();
    });

    it('should show an empty state when there are no secret types', () => {
      render(<HomePage />);

      expect(screen.getByText('No secret types available')).toBeInTheDocument();
    });
  });
});
