import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  installLayoutStubs,
  resetContainerWidth,
  setInitialContainerWidth,
} from '@marinoscar/platform-web/datatable/testing';
import { render } from '../utils/test-utils.js';
import { SecretsTable, type SecretsTableProps } from '../../src/secrets/ui/components/SecretsTable.js';
import type { SecretListItem, SecretType } from '../../src/core/headless/types.js';

const LOGIN: SecretType = {
  id: 'type-login', name: 'Login', description: null, icon: 'Key', fields: [],
  allowAttachments: false, isSystem: true, createdAt: '2026-01-01T00:00:00Z',
};
const API_KEY: SecretType = {
  id: 'type-api', name: 'API Key', description: null, icon: 'VpnKey', fields: [],
  allowAttachments: false, isSystem: true, createdAt: '2026-01-01T00:00:00Z',
};
const CARD: SecretType = {
  id: 'type-card', name: 'Card', description: null, icon: 'CreditCard', fields: [],
  allowAttachments: true, isSystem: true, createdAt: '2026-01-01T00:00:00Z',
};

const ROWS: SecretListItem[] = [
  { id: 's1', name: 'Org Alpha deploy key', description: 'CI token', type: API_KEY, currentVersion: 3, createdAt: '2026-01-10T00:00:00Z', updatedAt: '2026-02-15T08:30:00Z' },
  { id: 's2', name: 'Staging database', description: null, type: LOGIN, currentVersion: 1, createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-01T09:00:00Z' },
  { id: 's3', name: 'Test Visa 4242', description: null, type: CARD, currentVersion: 2, createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-02T09:00:00Z' },
];

function props(overrides: Partial<SecretsTableProps> = {}): SecretsTableProps {
  return {
    rows: ROWS,
    total: ROWS.length,
    page: 0,
    pageSize: 20,
    loading: false,
    error: null,
    sort: { field: 'updatedAt', direction: 'desc' },
    onSortChange: vi.fn(),
    onPaginationChange: vi.fn(),
    search: '',
    onSearchChange: vi.fn(),
    typeId: '',
    onTypeChange: vi.fn(),
    types: [LOGIN, API_KEY, CARD],
    onClearFilters: vi.fn(),
    onCreate: vi.fn(),
    onOpen: vi.fn(),
    onEdit: vi.fn(),
    onRenewCard: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
}

beforeAll(() => installLayoutStubs());

describe('SecretsTable', () => {
  describe('desktop grid', () => {
    beforeEach(() => {
      resetContainerWidth();
      setInitialContainerWidth(1400);
    });

    it('renders one row per secret with name, type, version and no values', async () => {
      render(<SecretsTable {...props()} />);
      const grid = await screen.findByRole('grid', { name: 'Secrets' });
      expect(within(grid).getByRole('columnheader', { name: /Name/ })).toBeInTheDocument();
      expect(within(grid).getByRole('columnheader', { name: /Type/ })).toBeInTheDocument();
      expect(within(grid).getByRole('columnheader', { name: /Version/ })).toBeInTheDocument();
      expect(within(grid).getByRole('columnheader', { name: /Updated/ })).toBeInTheDocument();
      expect(within(grid).getByText('Org Alpha deploy key')).toBeInTheDocument();
      expect(within(grid).getByText('CI token')).toBeInTheDocument();
      expect(within(grid).getByText('v3')).toBeInTheDocument();
      expect(within(grid).getAllByText('Login').length).toBeGreaterThan(0);
    });

    it('links each name to its detail page', async () => {
      render(<SecretsTable {...props()} />);
      const link = await screen.findByRole('link', { name: 'Staging database' });
      expect(link).toHaveAttribute('href', '/secrets/s2');
    });

    it('reports a header sort change to the page (server-side sort)', async () => {
      const user = userEvent.setup();
      const onSortChange = vi.fn();
      render(<SecretsTable {...props({ onSortChange })} />);
      const grid = await screen.findByRole('grid', { name: 'Secrets' });
      await user.click(within(grid).getByText('Name'));
      await waitFor(() =>
        expect(onSortChange).toHaveBeenCalledWith(expect.objectContaining({ field: 'name' })),
      );
      // The table never reorders rows itself.
      const names = within(grid).getAllByRole('link').map((a) => a.textContent);
      expect(names).toEqual(['Org Alpha deploy key', 'Staging database', 'Test Visa 4242']);
    });

    it('opens a row action menu with open, edit, renew (cards only) and delete', async () => {
      const user = userEvent.setup();
      const p = props();
      render(<SecretsTable {...p} />);
      await user.click(await screen.findByRole('button', { name: 'Row actions for Staging database' }));
      const menu = await screen.findByRole('menu');
      expect(within(menu).getByRole('menuitem', { name: /Renew card/ })).toHaveAttribute('aria-disabled', 'true');
      await user.click(within(menu).getByRole('menuitem', { name: /Open/ }));
      expect(p.onOpen).toHaveBeenCalledWith(ROWS[1]);
    });

    it('enables renew for a card row', async () => {
      const user = userEvent.setup();
      const p = props();
      render(<SecretsTable {...p} />);
      await user.click(await screen.findByRole('button', { name: 'Row actions for Test Visa 4242' }));
      await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /Renew card/ }));
      expect(p.onRenewCard).toHaveBeenCalledWith(ROWS[2]);
    });

    it('deletes only after the confirmation', async () => {
      const user = userEvent.setup();
      const p = props();
      render(<SecretsTable {...p} />);
      await user.click(await screen.findByRole('button', { name: 'Row actions for Staging database' }));
      await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /Delete/ }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/permanently deleted/)).toBeInTheDocument();
      expect(p.onDelete).not.toHaveBeenCalled();
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(p.onDelete).toHaveBeenCalledWith(ROWS[1]));
    });

    it('hides edit, renew and delete without the permissions', async () => {
      render(<SecretsTable {...props({ onEdit: undefined, onRenewCard: undefined, onDelete: undefined, onCreate: undefined })} />);
      // A single action renders as its own button rather than a menu.
      expect(await screen.findAllByRole('button', { name: 'Open for Staging database' })).toHaveLength(1);
      expect(screen.queryByRole('button', { name: /Row actions/ })).not.toBeInTheDocument();
    });

    it('shows the error from the page', async () => {
      render(<SecretsTable {...props({ rows: [], total: 0, error: 'Server unavailable' })} />);
      expect(await screen.findByText('Server unavailable')).toBeInTheDocument();
    });
  });

  describe('toolbar', () => {
    beforeEach(() => {
      resetContainerWidth();
      setInitialContainerWidth(1400);
    });

    it('reports a debounced search', async () => {
      const user = userEvent.setup();
      const onSearchChange = vi.fn();
      render(<SecretsTable {...props({ onSearchChange })} />);
      await user.type(screen.getByRole('searchbox', { name: 'Search secrets' }), 'db');
      await waitFor(() => expect(onSearchChange).toHaveBeenCalledWith('db'));
      expect(onSearchChange).toHaveBeenCalledTimes(1);
    });

    it('filters by type with every system and custom type offered', async () => {
      const user = userEvent.setup();
      const onTypeChange = vi.fn();
      render(<SecretsTable {...props({ onTypeChange })} />);
      await user.click(screen.getByRole('combobox', { name: 'Type' }));
      const listbox = await screen.findByRole('listbox');
      expect(within(listbox).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'All types', 'Login', 'API Key', 'Card',
      ]);
      await user.click(within(listbox).getByRole('option', { name: 'API Key' }));
      expect(onTypeChange).toHaveBeenCalledWith('type-api');
    });
  });

  describe('empty and loading states', () => {
    beforeEach(() => {
      resetContainerWidth();
      setInitialContainerWidth(1400);
    });

    it('invites the first secret when there are none', async () => {
      const user = userEvent.setup();
      const p = props({ rows: [], total: 0 });
      render(<SecretsTable {...p} />);
      expect(await screen.findByText('No secrets yet')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Create your first secret' }));
      expect(p.onCreate).toHaveBeenCalled();
    });

    it('offers to clear the filters when nothing matches', async () => {
      const user = userEvent.setup();
      const p = props({ rows: [], total: 0, search: 'zzz' });
      render(<SecretsTable {...p} />);
      expect(await screen.findByText('No secrets match your filters')).toBeInTheDocument();
      expect(screen.queryByText('No secrets yet')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Clear filters' }));
      expect(p.onClearFilters).toHaveBeenCalled();
    });

    it('shows the loading overlay while the first page loads', async () => {
      render(<SecretsTable {...props({ rows: [], total: 0, loading: true })} />);
      expect(await screen.findByTestId('datatable-loading-overlay')).toBeInTheDocument();
      expect(screen.queryByText('No secrets yet')).not.toBeInTheDocument();
    });
  });

  describe('phone card mode', () => {
    beforeEach(() => {
      resetContainerWidth();
      setInitialContainerWidth(360);
    });

    it('collapses rows to compact cards: name, description, type, age and version', async () => {
      render(<SecretsTable {...props()} />);
      const cards = await screen.findAllByTestId('datatable-card');
      expect(cards).toHaveLength(3);
      expect(screen.queryByRole('grid')).not.toBeInTheDocument();

      const first = within(cards[0]);
      expect(first.getByRole('link', { name: 'Org Alpha deploy key' })).toHaveAttribute('href', '/secrets/s1');
      expect(first.getByText('CI token')).toBeInTheDocument();
      expect(first.getByText('API Key')).toBeInTheDocument();
      expect(cards[0]).toHaveTextContent(/Updated .+ · v3/);
      // No label/value body: everything sits in the headline.
      expect(first.queryByTestId('datatable-card-body')).not.toBeInTheDocument();
    });

    it('keeps the row actions on each card', async () => {
      const user = userEvent.setup();
      const p = props();
      render(<SecretsTable {...p} />);
      await user.click(await screen.findByRole('button', { name: 'Row actions for Staging database' }));
      await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /Edit/ }));
      expect(p.onEdit).toHaveBeenCalledWith(ROWS[1]);
    });

    it('offers name and updated in the card sort control', async () => {
      const user = userEvent.setup();
      const onSortChange = vi.fn();
      render(<SecretsTable {...props({ onSortChange })} />);
      await screen.findAllByTestId('datatable-card');
      await user.click(screen.getByRole('combobox', { name: 'Sort by' }));
      const options = within(await screen.findByRole('listbox')).getAllByRole('option').map((o) => o.textContent);
      expect(options).toEqual(expect.arrayContaining(['Name', 'Updated']));
      await user.click(screen.getByRole('option', { name: 'Name' }));
      expect(onSortChange).toHaveBeenCalledWith(expect.objectContaining({ field: 'name' }));
    });
  });
});
