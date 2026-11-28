import { HttpResponse, http } from 'msw';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installLayoutStubs } from '@marinoscar/platform-web/datatable/testing';

import { render, mockUser, type MockUser } from '../utils/test-utils.js';
import { server } from '../mocks/server.js';
import SecretDetailPage from '../../src/secrets/ui/pages/SecretDetailPage.js';
import SecretsPage from '../../src/secrets/ui/pages/SecretsPage.js';
import {
  brokerAccessErrorMessage,
  isBrokerSupportedType,
  validateBrokerOrigin,
  validateInjectionName,
} from '../../src/secrets/headless/brokerAccess.js';
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

const field = (name: string, sensitive: boolean) => ({ name, label: name, type: 'string' as const, required: false, sensitive });
const API_KEY: SecretType = {
  id: 'type-key', name: 'API Key', description: null, icon: 'Key', fields: [field('key', true)],
  allowAttachments: false, isSystem: true, createdAt: '2026-01-01T00:00:00Z',
};
const NOTE: SecretType = {
  id: 'type-note', name: 'Secure Note', description: null, icon: 'Description', fields: [field('body', false)],
  allowAttachments: false, isSystem: true, createdAt: '2026-01-01T00:00:00Z',
};
const TWO: SecretType = {
  id: 'type-two', name: 'Pair', description: null, icon: null, fields: [field('id', true), field('secret', true)],
  allowAttachments: false, isSystem: false, createdAt: '2026-01-01T00:00:00Z',
};

function detail(type: SecretType, extra: Record<string, unknown> = {}) {
  return {
    id: SECRET_ID, name: 'Service key', description: null, type, currentVersion: 1,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
    agentAccess: 'none', agentAccessChangedAt: null, brokerAccess: false, brokerOrigins: [],
    values: { key: 'x', body: 'x', id: 'x', secret: 'x' },
    createdBy: { id: 'u1', email: 'owner@example.test' }, attachments: [], ...extra,
  };
}

function detailHandlers(d: ReturnType<typeof detail>) {
  server.use(
    http.get(`${API_BASE}/secrets/${SECRET_ID}`, () => HttpResponse.json(d)),
    http.get(`${API_BASE}/secrets/${SECRET_ID}/versions`, () => HttpResponse.json([])),
  );
}

const SWITCH = 'Allow use through the broker';
const ON = {
  brokerAccess: true,
  brokerOrigins: ['https://api.service-x.example'],
  brokerInjection: { kind: 'header', name: 'Authorization', prefix: 'Bearer' },
  brokerField: 'key',
};

describe('broker switch visibility', () => {
  it('shows for a supported type and hides for a Note', async () => {
    detailHandlers(detail(API_KEY));
    const first = render(<SecretDetailPage />, { wrapperOptions: { user: WRITER } });
    expect(await screen.findByRole('switch', { name: SWITCH })).not.toBeChecked();
    first.unmount();

    detailHandlers(detail(NOTE));
    render(<SecretDetailPage />, { wrapperOptions: { user: WRITER } });
    await screen.findByText('Service key');
    expect(screen.queryByRole('switch', { name: SWITCH })).not.toBeInTheDocument();
  });

  it('shows for an unsupported type that already has it on', async () => {
    detailHandlers(detail(NOTE, ON));
    render(<SecretDetailPage />, { wrapperOptions: { user: WRITER } });
    expect(await screen.findByRole('switch', { name: SWITCH })).toBeChecked();
  });
});

describe('broker dialog', () => {
  async function openDialog(type: SecretType = API_KEY) {
    detailHandlers(detail(type));
    const user = userEvent.setup();
    render(<SecretDetailPage />, { wrapperOptions: { user: WRITER } });
    await user.click(await screen.findByRole('switch', { name: SWITCH }));
    const dialog = await screen.findByRole('dialog', { name: SWITCH });
    return { user, dialog };
  }

  it('rejects http://, paths and localhost, and accepts a public https origin', async () => {
    const { user, dialog } = await openDialog();
    const input = within(dialog).getByLabelText('Origin');
    for (const [text, message] of [
      ['http://api.service-x.example', /must start with https/],
      ['https://api.service-x.example/v1', /no path/],
      ['https://localhost', /public host/],
      ['https://10.0.0.1', /IP address/],
    ] as const) {
      await user.clear(input);
      await user.type(input, text);
      await user.click(within(dialog).getByRole('button', { name: 'Add' }));
      expect(await within(dialog).findByText(message)).toBeInTheDocument();
    }
    await user.clear(input);
    await user.type(input, 'https://API.Service-X.example:443');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(within(dialog).getByText('https://api.service-x.example')).toBeInTheDocument();
  });

  it('needs an origin and sends the PATCH body', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.patch(`${API_BASE}/secrets/${SECRET_ID}/broker-access`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({
          data: detail(API_KEY, { ...ON, brokerInjection: { kind: 'query', name: 'api_key' } }),
        });
      }),
    );
    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(bodies).toEqual([]);
    expect(within(dialog).getByText('Add at least one origin')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Origin'), 'https://api.service-x.example');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Query parameter' }));
    const name = within(dialog).getByLabelText('Parameter name');
    expect(name).toHaveValue('api_key');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      enabled: true,
      origins: ['https://api.service-x.example'],
      injection: { kind: 'query', name: 'api_key' },
      field: 'key',
    });
    await waitFor(() => expect(screen.getByRole('switch', { name: SWITCH })).toBeChecked());
    expect(screen.getByText('Query parameter api_key (field key)')).toBeInTheDocument();
  });

  it('sends a default Authorization Bearer header', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    server.use(
      http.patch(`${API_BASE}/secrets/${SECRET_ID}/broker-access`, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ data: detail(API_KEY, ON) });
      }),
    );
    const { user, dialog } = await openDialog();
    await user.type(within(dialog).getByLabelText('Origin'), 'https://api.service-x.example');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]!.injection).toEqual({ kind: 'header', name: 'Authorization', prefix: 'Bearer' });
  });

  it('asks which field holds the key when a type has several sensitive fields', async () => {
    const { user, dialog } = await openDialog(TWO);
    await user.type(within(dialog).getByLabelText('Origin'), 'https://api.service-x.example');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    // Not sent until a field is chosen: the dialog stays open.
    expect(within(dialog).getByRole('combobox', { name: 'Field that holds the key' })).toBeInTheDocument();
  });

  it.each([
    ['BROKER_UNSUPPORTED_TYPE', /cannot be used through the broker/],
    ['BROKER_ORIGINS_REQUIRED', /at least one allowed origin/],
    ['BROKER_ORIGIN_INVALID', /not allowed/],
    ['BROKER_FIELD_INVALID', /which sensitive field/],
  ])('shows a friendly message for %s and keeps the switch off', async (code, message) => {
    server.use(
      http.patch(`${API_BASE}/secrets/${SECRET_ID}/broker-access`, () =>
        HttpResponse.json({ message: 'nope', code, statusCode: 422 }, { status: 422 }),
      ),
    );
    const { user, dialog } = await openDialog();
    await user.type(within(dialog).getByLabelText('Origin'), 'https://api.service-x.example');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText(message)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: SWITCH })).not.toBeInTheDocument());
    expect(screen.getByRole('switch', { name: SWITCH })).not.toBeChecked();
  });
});

describe('broker on state', () => {
  it('shows origins, injection, Edit and a copyable base URL per origin', async () => {
    detailHandlers(detail(API_KEY, ON));
    render(<SecretDetailPage />, { wrapperOptions: { user: WRITER } });
    expect(await screen.findByRole('switch', { name: SWITCH })).toBeChecked();
    expect(screen.getByText('Header Authorization: Bearer <key> (field key)')).toBeInTheDocument();
    expect(
      screen.getByText(`${window.location.origin}/api/broker/v1/${SECRET_ID}/api.service-x.example`),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit broker access' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy base URL for https://api.service-x.example' })).toBeInTheDocument();
  });

  it('turns off immediately without a dialog', async () => {
    detailHandlers(detail(API_KEY, ON));
    const bodies: unknown[] = [];
    server.use(
      http.patch(`${API_BASE}/secrets/${SECRET_ID}/broker-access`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ data: detail(API_KEY, { brokerAccess: false }) });
      }),
    );
    const user = userEvent.setup();
    render(<SecretDetailPage />, { wrapperOptions: { user: WRITER } });
    await user.click(await screen.findByRole('switch', { name: SWITCH }));
    await waitFor(() => expect(screen.getByRole('switch', { name: SWITCH })).not.toBeChecked());
    expect(bodies).toEqual([{ enabled: false }]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('broker helpers', () => {
  it('detects supported types', () => {
    expect(isBrokerSupportedType(API_KEY)).toBe(true);
    expect(isBrokerSupportedType(TWO)).toBe(true);
    expect(isBrokerSupportedType(NOTE)).toBe(false);
    expect(isBrokerSupportedType({ name: 'Credential', isSystem: true, fields: [field('password', true)] })).toBe(false);
    expect(isBrokerSupportedType({ name: 'Card', isSystem: true, fields: [field('number', true)] })).toBe(false);
  });

  it('validates origins and injection names', () => {
    expect(validateBrokerOrigin('https://api.service-x.example:8443')).toBeNull();
    expect(validateBrokerOrigin('https://user@api.service-x.example')).not.toBeNull();
    expect(validateBrokerOrigin('https://single')).not.toBeNull();
    expect(validateInjectionName('header', 'Cookie')).not.toBeNull();
    expect(validateInjectionName('header', 'X-Api-Key')).toBeNull();
    expect(validateInjectionName('query', 'api key')).not.toBeNull();
    expect(brokerAccessErrorMessage({ status: 404 })).toMatch(/owner/);
  });
});

describe('broker indicator in the list', () => {
  beforeAll(() => installLayoutStubs());

  it('renders the Broker chip only for rows allowed through the broker', async () => {
    const base = { description: null, type: API_KEY, currentVersion: 1, createdAt: '2026-01-01T00:00:00Z', agentAccess: 'none', agentAccessChangedAt: null } as const;
    const rows: SecretListItem[] = [
      { ...base, id: 's1', name: 'Brokered key', updatedAt: '2026-02-01T00:00:00Z', brokerAccess: true },
      { ...base, id: 's2', name: 'Plain key', updatedAt: '2026-01-15T00:00:00Z', brokerAccess: false },
    ];
    server.use(
      http.get(`${API_BASE}/secret-types`, () => HttpResponse.json({ data: [API_KEY] })),
      http.get(`${API_BASE}/secrets`, () =>
        HttpResponse.json({ data: { items: rows, meta: { page: 1, pageSize: 20, totalItems: 2, totalPages: 1 } } }),
      ),
    );
    render(<SecretsPage />, { wrapperOptions: { route: '/secrets', user: WRITER } });
    await screen.findByText('Plain key');
    expect(screen.getAllByText('Broker')).toHaveLength(1);
  });
});
