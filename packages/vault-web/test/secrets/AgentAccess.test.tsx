import { HttpResponse, http } from 'msw';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installLayoutStubs } from '@marinoscar/platform-web/datatable/testing';

import { render, mockUser, type MockUser } from '../utils/test-utils.js';
import { server } from '../mocks/server.js';
import SecretDetailPage from '../../src/secrets/ui/pages/SecretDetailPage.js';
import SecretsPage from '../../src/secrets/ui/pages/SecretsPage.js';
import type { SecretListItem, SecretType } from '../../src/core/headless/types.js';

const API_BASE = '*/api';
const SECRET_ID = 'secret-1';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn(), useParams: () => ({ id: 'secret-1' }) };
});

const WRITER: MockUser = {
  ...mockUser,
  permissions: [...mockUser.permissions, 'secrets:read', 'secrets:write', 'secrets:delete'],
};
const READER: MockUser = { ...mockUser, permissions: [...mockUser.permissions, 'secrets:read'] };

const CREDENTIAL: SecretType = {
  id: 'type-credential', name: 'Credential', description: null, icon: 'Key',
  fields: [{ name: 'username', label: 'Username', type: 'string', required: true, sensitive: false }],
  allowAttachments: false, isSystem: true, createdAt: '2026-01-01T00:00:00Z',
};
const NOTE: SecretType = {
  id: 'type-note', name: 'Secure Note', description: null, icon: 'Description',
  fields: [{ name: 'body', label: 'Body', type: 'string', required: false, sensitive: false }],
  allowAttachments: false, isSystem: true, createdAt: '2026-01-01T00:00:00Z',
};

function detail(type: SecretType, agentAccess: 'none' | 'fill' = 'none') {
  return {
    id: SECRET_ID, name: 'Shop login', description: null, type, currentVersion: 1,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
    agentAccess, agentAccessChangedAt: null,
    values: { username: 'person-a@example.test', body: 'x' },
    createdBy: { id: 'u1', email: 'owner@example.test' }, attachments: [],
  };
}

function detailHandlers(d: ReturnType<typeof detail>) {
  server.use(
    http.get(`${API_BASE}/secrets/${SECRET_ID}`, () => HttpResponse.json(d)),
    http.get(`${API_BASE}/secrets/${SECRET_ID}/versions`, () => HttpResponse.json([])),
  );
}

const SWITCH = 'Allow agents to use this login';

describe('agent access switch', () => {
  it('is shown for a Credential and hidden for other types', async () => {
    detailHandlers(detail(CREDENTIAL));
    const first = render(<SecretDetailPage />, { wrapperOptions: { user: WRITER } });
    expect(await screen.findByRole('switch', { name: SWITCH })).not.toBeChecked();
    expect(screen.getByText(/They never see it in chat/)).toBeInTheDocument();
    first.unmount();

    detailHandlers(detail(NOTE));
    render(<SecretDetailPage />, { wrapperOptions: { user: WRITER } });
    await screen.findByText('Shop login');
    expect(screen.queryByRole('switch', { name: SWITCH })).not.toBeInTheDocument();
  });

  it('is disabled without secrets:write', async () => {
    detailHandlers(detail(CREDENTIAL, 'fill'));
    render(<SecretDetailPage />, { wrapperOptions: { user: READER } });
    const sw = await screen.findByRole('switch', { name: SWITCH });
    expect(sw).toBeChecked();
    expect(sw).toBeDisabled();
  });

  it('PATCHes the right body and reflects the result', async () => {
    detailHandlers(detail(CREDENTIAL));
    const bodies: unknown[] = [];
    server.use(
      http.patch(`${API_BASE}/secrets/${SECRET_ID}/agent-access`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ data: detail(CREDENTIAL, 'fill') });
      }),
    );
    const user = userEvent.setup();
    render(<SecretDetailPage />, { wrapperOptions: { user: WRITER } });
    await user.click(await screen.findByRole('switch', { name: SWITCH }));
    await waitFor(() => expect(screen.getByRole('switch', { name: SWITCH })).toBeChecked());
    expect(bodies).toEqual([{ agentAccess: 'fill' }]);
    expect(await screen.findByText('Agents can now use this login')).toBeInTheDocument();
  });

  it('shows a friendly error and keeps the switch off when the API refuses', async () => {
    detailHandlers(detail(CREDENTIAL));
    server.use(
      http.patch(`${API_BASE}/secrets/${SECRET_ID}/agent-access`, () =>
        HttpResponse.json(
          { message: 'nope', code: 'AGENT_ACCESS_UNSUPPORTED_TYPE', statusCode: 422 },
          { status: 422 },
        ),
      ),
    );
    const user = userEvent.setup();
    render(<SecretDetailPage />, { wrapperOptions: { user: WRITER } });
    await user.click(await screen.findByRole('switch', { name: SWITCH }));
    expect(await screen.findByText(/Only a login, a card, an identity item or a service key/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: SWITCH })).not.toBeChecked();
  });
});

describe('agent access in the list', () => {
  beforeAll(() => installLayoutStubs());
  beforeEach(() => undefined);

  const ROWS: SecretListItem[] = [
    { id: 's1', name: 'Shop login', description: null, type: CREDENTIAL, currentVersion: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z', agentAccess: 'fill', agentAccessChangedAt: null },
    { id: 's2', name: 'Plain login', description: null, type: CREDENTIAL, currentVersion: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-15T00:00:00Z', agentAccess: 'none', agentAccessChangedAt: null },
  ];

  function listHandlers() {
    const requests: URLSearchParams[] = [];
    server.use(
      http.get(`${API_BASE}/secret-types`, () => HttpResponse.json({ data: [CREDENTIAL] })),
      http.get(`${API_BASE}/secrets`, ({ request }) => {
        const params = new URL(request.url).searchParams;
        requests.push(params);
        const items = ROWS.filter((r) => !params.get('agentAccess') || r.agentAccess === params.get('agentAccess'));
        return HttpResponse.json({
          data: { items, meta: { page: 1, pageSize: 20, totalItems: items.length, totalPages: 1 } },
        });
      }),
    );
    return requests;
  }

  it('renders the Agents chip only for fill rows', async () => {
    listHandlers();
    render(<SecretsPage />, { wrapperOptions: { route: '/secrets', user: WRITER } });
    await screen.findByText('Plain login');
    expect(screen.getAllByText('Agents')).toHaveLength(1);
  });

  it('sends agentAccess when the filter is chosen and reads it from the URL', async () => {
    const requests = listHandlers();
    const user = userEvent.setup();
    render(<SecretsPage />, { wrapperOptions: { route: '/secrets', user: WRITER } });
    await screen.findByText('Plain login');
    await user.click(screen.getByRole('combobox', { name: 'Agent access' }));
    await user.click(await screen.findByRole('option', { name: 'Allowed for agents' }));
    await waitFor(() => expect(requests[requests.length - 1].get('agentAccess')).toBe('fill'));
    await waitFor(() => expect(screen.queryByText('Plain login')).not.toBeInTheDocument());
  });

  it('applies ?agent=fill from the URL', async () => {
    const requests = listHandlers();
    render(<SecretsPage />, { wrapperOptions: { route: '/secrets?agent=fill', user: WRITER } });
    await screen.findByText('Shop login');
    expect(requests[0].get('agentAccess')).toBe('fill');
  });
});
