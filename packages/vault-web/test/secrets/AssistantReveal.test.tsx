import { HttpResponse, http } from 'msw';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installLayoutStubs } from '@marinoscar/platform-web/datatable/testing';

import { render, mockUser, type MockUser } from '../utils/test-utils.js';
import { server } from '../mocks/server.js';
import SecretDetailPage from '../../src/secrets/ui/pages/SecretDetailPage.js';
import SecretsPage from '../../src/secrets/ui/pages/SecretsPage.js';
import {
  assistantRevealErrorMessage,
  isAssistantRevealExcludedType,
} from '../../src/secrets/headless/secretFields.js';
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

const NOTE: SecretType = {
  id: 'type-note', name: 'Secure Note', description: null, icon: 'Description',
  fields: [{ name: 'body', label: 'Body', type: 'string', required: false, sensitive: false }],
  allowAttachments: false, isSystem: true, createdAt: '2026-01-01T00:00:00Z',
};
const CARD: SecretType = {
  id: 'type-card', name: 'Card', description: null, icon: 'CreditCard',
  fields: [{ name: 'number', label: 'Number', type: 'string', required: true, sensitive: true }],
  allowAttachments: true, isSystem: true, createdAt: '2026-01-01T00:00:00Z',
};

function detail(type: SecretType, assistantReveal = false) {
  return {
    id: SECRET_ID, name: 'Shop note', description: null, type, currentVersion: 1,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
    agentAccess: 'none', agentAccessChangedAt: null, assistantReveal, assistantRevealChangedAt: null,
    values: { body: 'x', number: '4242424242424242' },
    createdBy: { id: 'u1', email: 'owner@example.test' }, attachments: [],
  };
}

function detailHandlers(d: ReturnType<typeof detail>) {
  server.use(
    http.get(`${API_BASE}/secrets/${SECRET_ID}`, () => HttpResponse.json(d)),
    http.get(`${API_BASE}/secrets/${SECRET_ID}/versions`, () => HttpResponse.json([])),
  );
}

const SWITCH = 'Reveal to assistants';

describe('reveal to assistants switch', () => {
  it('is shown for a supported type and hidden for a Card', async () => {
    detailHandlers(detail(NOTE));
    const first = render(<SecretDetailPage />, { wrapperOptions: { user: WRITER } });
    expect(await screen.findByRole('switch', { name: SWITCH })).not.toBeChecked();
    expect(screen.getByText(/one field at a time/)).toBeInTheDocument();
    first.unmount();

    detailHandlers(detail(CARD));
    render(<SecretDetailPage />, { wrapperOptions: { user: WRITER } });
    await screen.findByText('Shop note');
    expect(screen.queryByRole('switch', { name: SWITCH })).not.toBeInTheDocument();
  });

  it('is shown for an excluded type that has it on, so the owner can switch it off', async () => {
    detailHandlers(detail(CARD, true));
    render(<SecretDetailPage />, { wrapperOptions: { user: WRITER } });
    expect(await screen.findByRole('switch', { name: SWITCH })).toBeChecked();
  });

  it('asks for confirmation before turning on and sends nothing on cancel', async () => {
    detailHandlers(detail(NOTE));
    const bodies: unknown[] = [];
    server.use(
      http.patch(`${API_BASE}/secrets/${SECRET_ID}/assistant-reveal`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ data: detail(NOTE, true) });
      }),
    );
    const user = userEvent.setup();
    render(<SecretDetailPage />, { wrapperOptions: { user: WRITER } });
    await user.click(await screen.findByRole('switch', { name: SWITCH }));
    expect(await screen.findByText(/cannot be taken back/)).toBeInTheDocument();
    expect(bodies).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText(/cannot be taken back/)).not.toBeInTheDocument());
    expect(bodies).toEqual([]);
    expect(screen.getByRole('switch', { name: SWITCH })).not.toBeChecked();

    await user.click(screen.getByRole('switch', { name: SWITCH }));
    await user.click(await screen.findByRole('button', { name: 'Reveal to assistants' }));
    await waitFor(() => expect(screen.getByRole('switch', { name: SWITCH })).toBeChecked());
    expect(bodies).toEqual([{ enabled: true }]);
  });

  it('turns off immediately without a dialog', async () => {
    detailHandlers(detail(NOTE, true));
    const bodies: unknown[] = [];
    server.use(
      http.patch(`${API_BASE}/secrets/${SECRET_ID}/assistant-reveal`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ data: detail(NOTE, false) });
      }),
    );
    const user = userEvent.setup();
    render(<SecretDetailPage />, { wrapperOptions: { user: WRITER } });
    await user.click(await screen.findByRole('switch', { name: SWITCH }));
    await waitFor(() => expect(screen.getByRole('switch', { name: SWITCH })).not.toBeChecked());
    expect(bodies).toEqual([{ enabled: false }]);
    expect(screen.queryByText(/cannot be taken back/)).not.toBeInTheDocument();
  });

  it('shows a friendly error on a 422 and keeps the switch off', async () => {
    detailHandlers(detail(NOTE));
    server.use(
      http.patch(`${API_BASE}/secrets/${SECRET_ID}/assistant-reveal`, () =>
        HttpResponse.json(
          { message: 'nope', code: 'ASSISTANT_REVEAL_UNSUPPORTED_TYPE', statusCode: 422 },
          { status: 422 },
        ),
      ),
    );
    const user = userEvent.setup();
    render(<SecretDetailPage />, { wrapperOptions: { user: WRITER } });
    await user.click(await screen.findByRole('switch', { name: SWITCH }));
    await user.click(await screen.findByRole('button', { name: 'Reveal to assistants' }));
    expect(await screen.findByText(/can never be revealed to an assistant/)).toBeInTheDocument();
    expect(await screen.findByRole('switch', { name: SWITCH })).not.toBeChecked();
  });
});

describe('assistant reveal helpers', () => {
  it('excludes Card, Passport, ID Document and cvv-like types', () => {
    expect(isAssistantRevealExcludedType(CARD)).toBe(true);
    expect(isAssistantRevealExcludedType({ ...NOTE, name: 'Passport' })).toBe(true);
    expect(isAssistantRevealExcludedType({ ...NOTE, name: 'ID Document' })).toBe(true);
    expect(
      isAssistantRevealExcludedType({ name: 'Custom', isSystem: false, fields: [{ name: 'CVV' }] }),
    ).toBe(true);
    expect(isAssistantRevealExcludedType(NOTE)).toBe(false);
    expect(isAssistantRevealExcludedType({ name: 'Card', isSystem: false, fields: [] })).toBe(false);
  });

  it('maps failures to friendly messages', () => {
    expect(assistantRevealErrorMessage({ code: 'ASSISTANT_REVEAL_UNSUPPORTED_TYPE' })).toMatch(/never be revealed/);
    expect(assistantRevealErrorMessage({ status: 404 })).toMatch(/owner/);
    expect(assistantRevealErrorMessage(new Error('boom'))).toBe('boom');
  });
});

describe('reveal indicator in the list', () => {
  beforeAll(() => installLayoutStubs());

  it('renders the Revealed chip only for rows revealed to assistants', async () => {
    const rows: SecretListItem[] = [
      { id: 's1', name: 'Open note', description: null, type: NOTE, currentVersion: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z', agentAccess: 'none', agentAccessChangedAt: null, assistantReveal: true },
      { id: 's2', name: 'Closed note', description: null, type: NOTE, currentVersion: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-15T00:00:00Z', agentAccess: 'none', agentAccessChangedAt: null, assistantReveal: false },
    ];
    server.use(
      http.get(`${API_BASE}/secret-types`, () => HttpResponse.json({ data: [NOTE] })),
      http.get(`${API_BASE}/secrets`, () =>
        HttpResponse.json({ data: { items: rows, meta: { page: 1, pageSize: 20, totalItems: 2, totalPages: 1 } } }),
      ),
    );
    render(<SecretsPage />, { wrapperOptions: { route: '/secrets', user: WRITER } });
    await screen.findByText('Closed note');
    expect(screen.getAllByText('Revealed')).toHaveLength(1);
  });
});
