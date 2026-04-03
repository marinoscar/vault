import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import { SecretsList } from '../../../components/secrets/SecretsList';
import type { SecretListItem, SecretType } from '../../../types';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const mockSecretType: SecretType = {
  id: 'type-1',
  name: 'Login',
  description: 'Username and password',
  icon: 'Key',
  fields: [],
  allowAttachments: false,
  isSystem: true,
  createdAt: '2024-01-01T00:00:00Z',
};

const mockSecretType2: SecretType = {
  id: 'type-2',
  name: 'API Key',
  description: null,
  icon: 'Token',
  fields: [],
  allowAttachments: false,
  isSystem: true,
  createdAt: '2024-01-01T00:00:00Z',
};

const mockSecret1: SecretListItem = {
  id: 'secret-1',
  name: 'GitHub Token',
  description: 'Personal access token',
  type: mockSecretType2,
  currentVersion: 3,
  createdAt: '2024-01-10T12:00:00Z',
  updatedAt: '2024-02-15T08:30:00Z',
};

const mockSecret2: SecretListItem = {
  id: 'secret-2',
  name: 'Production DB',
  description: null,
  type: mockSecretType,
  currentVersion: 1,
  createdAt: '2024-03-01T09:00:00Z',
  updatedAt: '2024-03-01T09:00:00Z',
};

// ---------------------------------------------------------------------------
// Default props helpers
// ---------------------------------------------------------------------------

function defaultProps(overrides: Partial<React.ComponentProps<typeof SecretsList>> = {}) {
  return {
    secrets: [],
    totalItems: 0,
    page: 1,
    pageSize: 10,
    totalPages: 0,
    isLoading: false,
    secretTypes: [mockSecretType, mockSecretType2],
    onFetch: vi.fn(),
    onRowClick: vi.fn(),
    onCreateClick: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SecretsList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Empty state', () => {
    it('should render empty state message when there are no secrets and no filters', async () => {
      render(<SecretsList {...defaultProps()} />);

      await waitFor(() => {
        expect(
          screen.getByText(/no secrets yet/i),
        ).toBeInTheDocument();
      });
    });

    it('should render filter-specific empty message when search is active', async () => {
      const user = userEvent.setup();

      render(<SecretsList {...defaultProps()} />);

      const searchInput = screen.getByLabelText(/search secrets/i);
      await user.type(searchInput, 'nonexistent');

      await waitFor(() => {
        expect(
          screen.getByText(/no secrets match your filters/i),
        ).toBeInTheDocument();
      });
    });

    it('should not render a table when secrets array is empty', async () => {
      render(<SecretsList {...defaultProps()} />);

      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('Rendering secrets in table', () => {
    it('should render a table with secrets when data is provided', async () => {
      render(
        <SecretsList
          {...defaultProps({
            secrets: [mockSecret1, mockSecret2],
            totalItems: 2,
          })}
        />,
      );

      await waitFor(() => {
        expect(screen.getByRole('table')).toBeInTheDocument();
      });
    });

    it('should display secret names in the table', async () => {
      render(
        <SecretsList
          {...defaultProps({
            secrets: [mockSecret1, mockSecret2],
            totalItems: 2,
          })}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('GitHub Token')).toBeInTheDocument();
        expect(screen.getByText('Production DB')).toBeInTheDocument();
      });
    });

    it('should display secret type names as chips', async () => {
      render(
        <SecretsList
          {...defaultProps({
            secrets: [mockSecret1, mockSecret2],
            totalItems: 2,
          })}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('API Key')).toBeInTheDocument();
        expect(screen.getByText('Login')).toBeInTheDocument();
      });
    });

    it('should display version numbers prefixed with v', async () => {
      render(
        <SecretsList
          {...defaultProps({
            secrets: [mockSecret1, mockSecret2],
            totalItems: 2,
          })}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('v3')).toBeInTheDocument();
        expect(screen.getByText('v1')).toBeInTheDocument();
      });
    });

    it('should display the table column headers', async () => {
      render(
        <SecretsList
          {...defaultProps({
            secrets: [mockSecret1],
            totalItems: 1,
          })}
        />,
      );

      await waitFor(() => {
        expect(screen.getByRole('columnheader', { name: /name/i })).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: /type/i })).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: /version/i })).toBeInTheDocument();
      });
    });

    it('should display a description when the secret has one', async () => {
      render(
        <SecretsList
          {...defaultProps({
            secrets: [mockSecret1],
            totalItems: 1,
          })}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('Personal access token')).toBeInTheDocument();
      });
    });
  });

  describe('Loading state', () => {
    it('should render a progress indicator while loading', () => {
      render(<SecretsList {...defaultProps({ isLoading: true })} />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('should not render a table while loading', () => {
      render(<SecretsList {...defaultProps({ isLoading: true })} />);

      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('Search', () => {
    it('should render a search input', () => {
      render(<SecretsList {...defaultProps()} />);

      expect(screen.getByLabelText(/search secrets/i)).toBeInTheDocument();
    });

    it('should call onFetch with search term when user types in search field', async () => {
      const user = userEvent.setup();
      const onFetch = vi.fn();

      render(<SecretsList {...defaultProps({ onFetch })} />);

      const searchInput = screen.getByLabelText(/search secrets/i);
      await user.type(searchInput, 'db');

      await waitFor(() => {
        expect(onFetch).toHaveBeenCalledWith(
          expect.objectContaining({ search: 'db', page: 1 }),
        );
      });
    });

    it('should reset to page 1 when search changes', async () => {
      const user = userEvent.setup();
      const onFetch = vi.fn();

      render(<SecretsList {...defaultProps({ onFetch, page: 3 })} />);

      const searchInput = screen.getByLabelText(/search secrets/i);
      await user.type(searchInput, 'x');

      await waitFor(() => {
        expect(onFetch).toHaveBeenCalledWith(
          expect.objectContaining({ page: 1 }),
        );
      });
    });
  });

  describe('Row click', () => {
    it('should call onRowClick with the secret id when a row is clicked', async () => {
      const user = userEvent.setup();
      const onRowClick = vi.fn();

      render(
        <SecretsList
          {...defaultProps({
            secrets: [mockSecret1, mockSecret2],
            totalItems: 2,
            onRowClick,
          })}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('GitHub Token')).toBeInTheDocument();
      });

      await user.click(screen.getByText('GitHub Token'));

      await waitFor(() => {
        expect(onRowClick).toHaveBeenCalledWith('secret-1');
      });
    });

    it('should call onRowClick with the correct id for the second row', async () => {
      const user = userEvent.setup();
      const onRowClick = vi.fn();

      render(
        <SecretsList
          {...defaultProps({
            secrets: [mockSecret1, mockSecret2],
            totalItems: 2,
            onRowClick,
          })}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('Production DB')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Production DB'));

      await waitFor(() => {
        expect(onRowClick).toHaveBeenCalledWith('secret-2');
      });
    });
  });

  describe('Create button', () => {
    it('should render the New Secret button', () => {
      render(<SecretsList {...defaultProps()} />);

      expect(screen.getByRole('button', { name: /new secret/i })).toBeInTheDocument();
    });

    it('should call onCreateClick when New Secret button is clicked', async () => {
      const user = userEvent.setup();
      const onCreateClick = vi.fn();

      render(<SecretsList {...defaultProps({ onCreateClick })} />);

      await user.click(screen.getByRole('button', { name: /new secret/i }));

      expect(onCreateClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('Delete button', () => {
    it('should render delete button for each row when onDeleteClick is provided', async () => {
      render(
        <SecretsList
          {...defaultProps({
            secrets: [mockSecret1, mockSecret2],
            totalItems: 2,
            onDeleteClick: vi.fn(),
          })}
        />,
      );

      await waitFor(() => {
        const deleteButtons = screen.getAllByRole('button', { name: /delete secret/i });
        expect(deleteButtons).toHaveLength(2);
      });
    });

    it('should call onDeleteClick with the correct id when delete button is clicked', async () => {
      const user = userEvent.setup();
      const onDeleteClick = vi.fn();

      render(
        <SecretsList
          {...defaultProps({
            secrets: [mockSecret1],
            totalItems: 1,
            onDeleteClick,
          })}
        />,
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /delete secret/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /delete secret/i }));

      expect(onDeleteClick).toHaveBeenCalledWith('secret-1');
    });

    it('should not render delete buttons when onDeleteClick is not provided', async () => {
      render(
        <SecretsList
          {...defaultProps({
            secrets: [mockSecret1],
            totalItems: 1,
          })}
        />,
      );

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /delete secret/i })).not.toBeInTheDocument();
      });
    });
  });

  describe('Type filter', () => {
    it('should render a type filter dropdown', () => {
      render(<SecretsList {...defaultProps()} />);

      expect(screen.getByRole('combobox', { name: /type/i })).toBeInTheDocument();
    });
  });

  describe('Pagination', () => {
    it('should render pagination controls when secrets exist', async () => {
      render(
        <SecretsList
          {...defaultProps({
            secrets: [mockSecret1, mockSecret2],
            totalItems: 2,
          })}
        />,
      );

      await waitFor(() => {
        // MUI TablePagination renders rows-per-page selector
        expect(screen.getByRole('combobox', { name: /rows per page/i })).toBeInTheDocument();
      });
    });
  });
});
