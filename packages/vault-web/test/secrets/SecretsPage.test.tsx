import { HttpResponse, http } from 'msw';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import {
  installLayoutStubs,
  resetContainerWidth,
  setInitialContainerWidth,
} from '@marinoscar/platform-web/datatable/testing';
import { render, mockUser, type MockUser } from '../utils/test-utils.js';
import { server } from '../mocks/server.js';
import SecretsPage from '../../src/secrets/ui/pages/SecretsPage.js';
import type { SecretListItem, SecretType } from '../../src/core/headless/types.js';

const API_BASE = '*/api';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const LOGIN: SecretType = {
  id: '11111111-1111-4111-8111-111111111111', name: 'Login', description: null, icon: 'Key',
  fields: [], allowAttachments: false, isSystem: true, createdAt: '2026-01-01T00:00:00Z',
};
const NOTE: SecretType = {
  id: '22222222-2222-4222-8222-222222222222', name: 'Secure Note', description: null, icon: 'Description',
  fields: [], allowAttachments: false, isSystem: true, createdAt: '2026-01-01T00:00:00Z',
};

const ROWS: SecretListItem[] = [
  { id: 's1', name: 'Staging database', description: null, type: LOGIN, currentVersion: 2, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' },
  { id: 's2', name: 'Wi-Fi guest network', description: null, type: NOTE, currentVersion: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-15T00:00:00Z' },
];

const WRITER: MockUser = {
  ...mockUser,
  permissions: [...mockUser.permissions, 'secrets:read', 'secrets:write', 'secrets:delete'],
};
const READER: MockUser = { ...mockUser, permissions: [...mockUser.permissions, 'secrets:read'] };

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

/** Records every list request's query and answers with `rows`. */
function listHandlers(rows: SecretListItem[] = ROWS) {
  const requests: URLSearchParams[] = [];
  const deleted: string[] = [];
  let current = [...rows];
  server.use(
    http.get(`${API_BASE}/secret-types`, () => HttpResponse.json({ data: [LOGIN, NOTE] })),
    http.get(`${API_BASE}/secrets`, ({ request }) => {
      const params = new URL(request.url).searchParams;
      requests.push(params);
      const items = current.filter(
        (s) =>
          (!params.get('search') || s.name.toLowerCase().includes(params.get('search')!.toLowerCase())) &&
          (!params.get('typeId') || s.type.id === params.get('typeId')),
      );
      return HttpResponse.json({
        data: { items, meta: { page: 1, pageSize: 20, totalItems: items.length, totalPages: 1 } },
      });
    }),
    http.delete(`${API_BASE}/secrets/:id`, ({ params }) => {
      deleted.push(params.id as string);
      current = current.filter((s) => s.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return { requests, deleted, last: () => requests[requests.length - 1] };
}

function renderPage(route = '/secrets', user: MockUser = WRITER) {
  return render(
    <>
      <SecretsPage />
      <LocationProbe />
    </>,
    { wrapperOptions: { route, user } },
  );
}

beforeAll(() => installLayoutStubs());

beforeEach(() => {
  mockNavigate.mockReset();
  resetContainerWidth();
  setInitialContainerWidth(1400);
  window.localStorage.clear();
});

describe('SecretsPage', () => {
  it('loads the first page sorted by most recently updated', async () => {
    const api = listHandlers();
    renderPage();
    expect(await screen.findByText('Staging database')).toBeInTheDocument();
    expect(screen.getByText('2 secrets')).toBeInTheDocument();
    const q = api.last();
    expect(q.get('page')).toBe('1');
    expect(q.get('pageSize')).toBe('20');
    expect(q.get('sortBy')).toBe('updatedAt');
    expect(q.get('sortOrder')).toBe('desc');
  });

  it('restores search, type, sort and page from the URL', async () => {
    const api = listHandlers();
    renderPage(`/secrets?q=wi&type=${NOTE.id}&sort=name&dir=asc&page=2&size=50`);
    await waitFor(() => expect(api.requests.length).toBeGreaterThan(0));
    const q = api.last();
    expect(q.get('search')).toBe('wi');
    expect(q.get('typeId')).toBe(NOTE.id);
    expect(q.get('sortBy')).toBe('name');
    expect(q.get('sortOrder')).toBe('asc');
    expect(q.get('page')).toBe('2');
    expect(q.get('pageSize')).toBe('50');
    expect(screen.getByRole('searchbox', { name: 'Search secrets' })).toHaveValue('wi');
  });

  it('writes the search to the URL and resets to page 1', async () => {
    const user = userEvent.setup();
    const api = listHandlers();
    renderPage('/secrets?page=3');
    await screen.findByText('Staging database');
    await user.type(screen.getByRole('searchbox', { name: 'Search secrets' }), 'staging');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?q=staging'));
    await waitFor(() => expect(api.last().get('search')).toBe('staging'));
    expect(api.last().get('page')).toBe('1');
    expect(await screen.findByText('1 secret match')).toBeInTheDocument();
  });

  it('filters by type through the URL', async () => {
    const user = userEvent.setup();
    const api = listHandlers();
    renderPage();
    await screen.findByText('Staging database');
    await user.click(screen.getByRole('combobox', { name: 'Type' }));
    await user.click(await screen.findByRole('option', { name: 'Secure Note' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`type=${NOTE.id}`));
    await waitFor(() => expect(api.last().get('typeId')).toBe(NOTE.id));
    await waitFor(() => expect(screen.queryByText('Staging database')).not.toBeInTheDocument());
    expect(screen.getByText('Wi-Fi guest network')).toBeInTheDocument();
  });

  it('sorts on the server when a header is clicked', async () => {
    const user = userEvent.setup();
    const api = listHandlers();
    renderPage();
    const grid = await screen.findByRole('grid', { name: 'Secrets' });
    await user.click(within(grid).getByText('Name'));
    await waitFor(() => expect(api.last().get('sortBy')).toBe('name'));
    expect(screen.getByTestId('location')).toHaveTextContent('sort=name');
  });

  it('offers "New secret" to a writer and navigates to the form', async () => {
    const user = userEvent.setup();
    listHandlers();
    renderPage();
    await screen.findByText('Staging database');
    await user.click(screen.getByRole('button', { name: 'New secret' }));
    expect(mockNavigate).toHaveBeenCalledWith('/secrets/new');
  });

  it('hides create, edit and delete from a read-only user', async () => {
    listHandlers();
    renderPage('/secrets', READER);
    await screen.findByText('Staging database');
    expect(screen.queryByRole('button', { name: 'New secret' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open for Staging database' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Row actions/ })).not.toBeInTheDocument();
  });

  it('deletes a secret after confirmation and reloads the list', async () => {
    const user = userEvent.setup();
    const api = listHandlers();
    renderPage();
    await screen.findByText('Staging database');
    await user.click(screen.getByRole('button', { name: 'Row actions for Staging database' }));
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /Delete/ }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.deleted).toEqual(['s1']));
    expect(await screen.findByText('Deleted "Staging database"')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Staging database')).not.toBeInTheDocument());
  });

  it('shows the API error in the table', async () => {
    server.use(
      http.get(`${API_BASE}/secret-types`, () => HttpResponse.json({ data: [] })),
      http.get(`${API_BASE}/secrets`, () => HttpResponse.json({ message: 'Database offline' }, { status: 500 })),
    );
    renderPage();
    expect(await screen.findByText('Database offline')).toBeInTheDocument();
  });
});
