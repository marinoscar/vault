import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, mockUser } from '../utils/test-utils.js';
import { server } from '../mocks/server.js';
import BrokerTokensPage from '../../src/agent/ui/pages/BrokerTokensPage.js';
import { brokerTokenStatus } from '../../src/agent/headless/brokerTokens.js';

const API_BASE = '*/api';
const TOKEN = `vbk_${'A'.repeat(40)}`;

const row = (over: Record<string, unknown> = {}) => ({
  id: 't1', name: 'Cloud agent', tokenPrefix: 'vbk_AAAAAAAA', secretIds: [], expiresAt: '2099-01-01T00:00:00Z',
  lastUsedAt: null, revokedAt: null, createdAt: '2026-03-01T00:00:00Z', ...over,
});

function handlers(initial = [row()]) {
  let tokens = initial;
  const created: unknown[] = [];
  const revoked: string[] = [];
  server.use(
    http.get(`${API_BASE}/broker/tokens`, () => HttpResponse.json({ data: tokens })),
    http.get(`${API_BASE}/secrets`, ({ request }) => {
      expect(new URL(request.url).searchParams.get('brokerAccess')).toBe('true');
      return HttpResponse.json({
        data: {
          items: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Service key', type: { name: 'API Key', fields: [] } }],
          meta: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
        },
      });
    }),
    http.post(`${API_BASE}/broker/tokens`, async ({ request }) => {
      created.push(await request.json());
      tokens = [row({ id: 't2', name: 'New one' }), ...tokens];
      return HttpResponse.json({ data: { ...row({ id: 't2', name: 'New one' }), token: TOKEN } });
    }),
    http.post(`${API_BASE}/broker/tokens/:id/revoke`, ({ params }) => {
      revoked.push(String(params.id));
      tokens = tokens.map((t) => (t.id === params.id ? { ...t, revokedAt: '2026-03-02T00:00:00Z' } : t));
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return { created, revoked };
}

const renderPage = () => render(<BrokerTokensPage />, { wrapperOptions: { user: mockUser } });

describe('BrokerTokensPage', () => {
  it('lists tokens without any token value', async () => {
    handlers();
    renderPage();
    expect(await screen.findByText('Cloud agent')).toBeInTheDocument();
    expect(screen.getByText('vbk_AAAAAAAA…')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText(/All broker-enabled secrets/)).toBeInTheDocument();
    expect(screen.getByText(/network secret for your Vault host/)).toBeInTheDocument();
  });

  it('creates a token, shows it once and never again after closing', async () => {
    const { created } = handlers();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Cloud agent');
    await user.click(screen.getByRole('button', { name: 'Create token' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create a broker token' });
    await user.type(within(dialog).getByLabelText(/Name/), 'New one');
    await user.click(within(dialog).getByRole('combobox', { name: 'Expires after' }));
    await user.click(await screen.findByRole('option', { name: '365 days' }));
    await user.click(within(dialog).getByRole('combobox', { name: /Restrict to secrets/ }));
    await user.click(await screen.findByRole('option', { name: 'Service key' }));
    await user.click(within(dialog).getByRole('button', { name: 'Create token' }));

    const shown = await screen.findByRole('dialog', { name: 'Copy your broker token' });
    expect(created).toEqual([{ name: 'New one', expiresInDays: 365, secretIds: ['11111111-1111-4111-8111-111111111111'] }]);
    expect(within(shown).getByLabelText('Broker token')).toHaveValue(TOKEN);
    expect(within(shown).getByText(/only time the token is shown/)).toBeInTheDocument();

    await user.click(within(shown).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue(TOKEN)).not.toBeInTheDocument();
    expect(screen.queryByText(TOKEN)).not.toBeInTheDocument();
    expect(await screen.findByText('New one')).toBeInTheDocument();
  });

  it('validates a custom expiry', async () => {
    handlers();
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Create token' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create a broker token' });
    await user.type(within(dialog).getByLabelText(/Name/), 'X');
    await user.click(within(dialog).getByRole('combobox', { name: 'Expires after' }));
    await user.click(await screen.findByRole('option', { name: 'Custom' }));
    const days = within(dialog).getByLabelText('Days');
    await user.clear(days);
    await user.type(days, '5000');
    expect(within(dialog).getByText(/from 1 to 3650/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create token' })).toBeDisabled();
  });

  it('revokes after a confirmation', async () => {
    const { revoked } = handlers();
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Revoke Cloud agent' }));
    expect(revoked).toEqual([]);
    await user.click(await screen.findByRole('button', { name: 'Revoke token' }));
    await waitFor(() => expect(revoked).toEqual(['t1']));
    expect(await screen.findByText('Revoked')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke Cloud agent' })).not.toBeInTheDocument();
  });

  it('derives the status from the dates', () => {
    expect(brokerTokenStatus({ expiresAt: '2000-01-01T00:00:00Z', revokedAt: null })).toBe('expired');
    expect(brokerTokenStatus({ expiresAt: '2000-01-01T00:00:00Z', revokedAt: '2000-01-02T00:00:00Z' })).toBe('revoked');
    expect(brokerTokenStatus({ expiresAt: null, revokedAt: null })).toBe('active');
  });
});
