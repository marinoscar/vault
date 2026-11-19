import { HttpResponse, http } from 'msw';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  installLayoutStubs,
  resetContainerWidth,
  setInitialContainerWidth,
} from '@marinoscar/platform-web/datatable/testing';
import { render, mockUser } from '../utils/test-utils.js';
import { server } from '../mocks/server.js';
import AgentActivityPage from '../../src/agent/ui/pages/AgentActivityPage.js';
import type { AgentActivityItem } from '../../src/agent/headless/agentActivity.js';

const API_BASE = '*/api';
const USER = { ...mockUser, permissions: [...mockUser.permissions, 'secrets:read'] };

const ROWS: AgentActivityItem[] = [
  {
    id: 'a1', at: '2026-03-01T10:00:00Z', action: 'fill', result: 'ok', secretId: 's1', secretName: 'Shop login',
    field: 'password', origin: 'https://shop.example.test', purpose: 'Check an order', credentialKind: 'oauth',
    clientId: 'c1', clientName: 'Assistant X',
  },
  {
    id: 'a2', at: '2026-03-01T11:00:00Z', action: 'lookup', result: 'denied', reason: 'not_allowed', secretId: null,
    secretName: null, field: null, origin: 'https://other.example.test', purpose: null, credentialKind: 'pat',
    clientId: null, clientName: null,
  },
];

function handlers(rows: AgentActivityItem[] = ROWS, total = rows.length) {
  const requests: URLSearchParams[] = [];
  server.use(
    http.get(`${API_BASE}/agent-activity`, ({ request }) => {
      const params = new URL(request.url).searchParams;
      requests.push(params);
      const action = params.get('action');
      const items = action ? rows.filter((r) => r.action === action) : rows;
      return HttpResponse.json({ data: items, meta: { page: Number(params.get('page')), pageSize: 25, total } });
    }),
  );
  return { requests, last: () => requests[requests.length - 1] };
}

beforeAll(() => installLayoutStubs());
beforeEach(() => {
  resetContainerWidth();
  setInitialContainerWidth(1400);
  window.localStorage.clear();
});

const renderPage = () => render(<AgentActivityPage />, { wrapperOptions: { user: USER } });

describe('AgentActivityPage', () => {
  it('renders rows with the app, secret link, website and a denied chip with its reason', async () => {
    handlers();
    renderPage();
    expect(await screen.findByText('Assistant X')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Shop login' })).toHaveAttribute('href', '/secrets/s1');
    expect(screen.getByText('https://shop.example.test')).toBeInTheDocument();
    expect(screen.getByText('Personal access token')).toBeInTheDocument();
    expect(screen.getByText('OK')).toBeInTheDocument();
    expect(screen.getByLabelText('Denied: not_allowed')).toBeInTheDocument();
    expect(screen.queryByText(/^password$/i)).not.toBeInTheDocument();
  });

  it('links to Connected apps', async () => {
    handlers();
    renderPage();
    expect(await screen.findByRole('link', { name: /manage connected apps/i })).toHaveAttribute('href', '/settings/connected-apps');
  });

  it('sends the action filter and starts again at page 1', async () => {
    const api = handlers();
    renderPage();
    await screen.findByText('Assistant X');
    expect(api.last().get('page')).toBe('1');
    await userEvent.click(screen.getByRole('combobox', { name: 'Action' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Filled' }));
    await waitFor(() => expect(api.last().get('action')).toBe('fill'));
    expect(api.last().get('page')).toBe('1');
  });

  it('sends the date range as ISO bounds', async () => {
    const api = handlers();
    renderPage();
    await screen.findByText('Assistant X');
    await userEvent.type(screen.getByLabelText('From'), '2026-03-01');
    await waitFor(() => expect(api.last().get('from')).toMatch(/^2026-03-0[01]T/));
  });

  it('pages through the server total', async () => {
    const api = handlers(ROWS, 80);
    renderPage();
    await screen.findByText('Assistant X');
    await userEvent.click(screen.getByRole('button', { name: /next page/i }));
    await waitFor(() => expect(api.last().get('page')).toBe('2'));
  });

  it('shows the empty state', async () => {
    handlers([]);
    renderPage();
    expect(
      await screen.findByText("No agent activity yet. Agents only see the logins, cards and identity details you allow on the secret's page."),
    ).toBeInTheDocument();
  });

  it('shows an error', async () => {
    server.use(http.get(`${API_BASE}/agent-activity`, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
    renderPage();
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
  });
});
