import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render, mockUser } from '../utils/test-utils.js';
import { server } from '../mocks/server.js';
import { CardAgentAccessPanel } from '../../src/agent/ui/components/CardAgentAccessPanel.js';
import { describeGrantLimits, cardGrantErrorMessage, type CardGrant, type CardGrantRequest } from '../../src/agent/headless/cardGrants.js';

const API_BASE = '*/api';
const CARD = 'card-1';

const GRANT: CardGrant = {
  id: 'grant-1', secretId: CARD, merchantOrigin: 'https://shop.example.test', merchantSite: 'example.test',
  frameOrigins: ['https://pay.example.test'], maxAmount: 100, currency: 'USD',
  periodLimit: { period: 'month', maxReleases: 3, maxAmount: null }, expiresAt: null, includeSecurityCode: true,
  status: 'active', createdAt: '2026-03-01T00:00:00Z', revokedAt: null,
  usage: { periodReleases: 2, periodAmount: 45.5, totalReleases: 4, lastReleasedAt: '2026-03-02T00:00:00Z' },
};
const REVOKED: CardGrant = { ...GRANT, id: 'grant-0', merchantOrigin: 'https://old-shop.example.test', status: 'revoked', revokedAt: '2026-02-01T00:00:00Z', includeSecurityCode: false, frameOrigins: [], periodLimit: null, usage: { periodReleases: 0, periodAmount: 0, totalReleases: 0, lastReleasedAt: null } };
const REQUEST: CardGrantRequest = {
  id: 'req-1', secretId: CARD, origin: 'https://books.example.test', merchantSite: 'example.test', amount: 42.5,
  currency: 'EUR', reason: 'Order for Person A', status: 'pending', clientName: 'Assistant X',
  createdAt: '2026-03-03T00:00:00Z', decidedAt: null, grantId: null,
};

function handlers(options: { grants?: CardGrant[]; requests?: CardGrantRequest[]; createStatus?: number } = {}) {
  let grants = options.grants ?? [GRANT, REVOKED];
  let requests = options.requests ?? [REQUEST];
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  server.use(
    http.get(`${API_BASE}/secrets/${CARD}/card-grants`, () => HttpResponse.json({ data: grants })),
    http.get(`${API_BASE}/secrets/${CARD}/card-grant-requests`, ({ request }) => {
      expect(new URL(request.url).searchParams.get('status')).toBe('pending');
      return HttpResponse.json({ data: requests });
    }),
    http.post(`${API_BASE}/secrets/${CARD}/card-grants`, async ({ request }) => {
      const body = await request.json();
      calls.push({ method: 'POST', path: 'card-grants', body });
      if (options.createStatus === 409) {
        return HttpResponse.json({ message: 'exists', code: 'CARD_GRANT_EXISTS', statusCode: 409 }, { status: 409 });
      }
      return HttpResponse.json({ data: { ...GRANT, id: 'grant-2' } }, { status: 201 });
    }),
    http.delete(`${API_BASE}/secrets/${CARD}/card-grants/:grantId`, ({ params }) => {
      calls.push({ method: 'DELETE', path: `card-grants/${params.grantId}` });
      grants = grants.map((g) => (g.id === params.grantId ? { ...g, status: 'revoked' as const } : g));
      return HttpResponse.json({ data: grants.find((g) => g.id === params.grantId) });
    }),
    http.post(`${API_BASE}/secrets/${CARD}/card-grant-requests/:id/approve`, ({ params }) => {
      calls.push({ method: 'POST', path: `approve/${params.id}` });
      requests = [];
      grants = [{ ...GRANT, id: 'grant-3', merchantOrigin: REQUEST.origin, maxAmount: 42.5, currency: 'EUR' }, ...grants];
      return HttpResponse.json({ data: { request: { ...REQUEST, status: 'approved' }, grant: grants[0] } });
    }),
    http.post(`${API_BASE}/secrets/${CARD}/card-grant-requests/:id/decline`, ({ params }) => {
      calls.push({ method: 'POST', path: `decline/${params.id}` });
      requests = [];
      return HttpResponse.json({ data: { ...REQUEST, status: 'declined' } });
    }),
  );
  return calls;
}

const panel = (over: Partial<Parameters<typeof CardAgentAccessPanel>[0]> = {}) => (
  <CardAgentAccessPanel secretId={CARD} cardName="Card A" agentAccess="fill" canWrite onToggle={vi.fn()} {...over} />
);

describe('CardAgentAccessPanel', () => {
  it('lists the grants with their limits, use and status, and never a card number', async () => {
    handlers();
    const { container } = render(panel(), { wrapperOptions: { user: mockUser } });
    const rows = await screen.findAllByTestId('card-grant');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('https://shop.example.test')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Active')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Security code')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Up to 100.00 USD per purchase · 3 per month')).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/Used 2 times this month \(45\.50 USD\), 4 in all/)).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Payment frames: https://pay.example.test')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Revoked')).toBeInTheDocument();
    expect(within(rows[1]!).queryByRole('button', { name: /Revoke/ })).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d{12,}/);
  });

  it('shows a pending request and approves it, which reloads the grants', async () => {
    const calls = handlers();
    render(panel(), { wrapperOptions: { user: mockUser } });
    const request = await screen.findByTestId('card-grant-request');
    expect(request).toHaveTextContent('Assistant X asks to use this card at https://books.example.test for up to 42.50 EUR.');
    expect(request).toHaveTextContent('“Order for Person A”');
    await userEvent.click(screen.getByRole('button', { name: 'Approve https://books.example.test' }));
    await waitFor(() => expect(screen.queryByTestId('card-grant-request')).not.toBeInTheDocument());
    expect(calls).toEqual([{ method: 'POST', path: 'approve/req-1' }]);
    expect(await screen.findByText(/Up to 42\.50 EUR per purchase/)).toBeInTheDocument();
  });

  it('declines a request', async () => {
    const calls = handlers();
    render(panel(), { wrapperOptions: { user: mockUser } });
    await userEvent.click(await screen.findByRole('button', { name: 'Decline https://books.example.test' }));
    await waitFor(() => expect(calls).toEqual([{ method: 'POST', path: 'decline/req-1' }]));
    await waitFor(() => expect(screen.queryByTestId('card-grant-request')).not.toBeInTheDocument());
  });

  it('revokes an active grant', async () => {
    const calls = handlers();
    render(panel(), { wrapperOptions: { user: mockUser } });
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke https://shop.example.test' }));
    await waitFor(() => expect(calls).toEqual([{ method: 'DELETE', path: 'card-grants/grant-1' }]));
  });

  it('adds a shop through the form with the required amount and currency, security code off by default', async () => {
    const calls = handlers({ grants: [], requests: [] });
    render(panel(), { wrapperOptions: { user: mockUser } });
    expect(await screen.findByText(/No shop yet\. Agents cannot use this card until you allow one\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Allow a shop' }));
    const dialog = await screen.findByRole('dialog', { name: 'Allow a shop for Card A' });
    // Nothing is sent while the form is invalid.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Allow shop' }));
    expect(within(dialog).getByText("Enter the shop's website, for example shop.example.test.")).toBeInTheDocument();
    expect(calls).toHaveLength(0);

    await userEvent.type(within(dialog).getByLabelText(/Shop website/), 'shop.example.test');
    await userEvent.type(within(dialog).getByLabelText(/Most per purchase/), '75.5');
    const currency = within(dialog).getByLabelText(/Currency/);
    await userEvent.clear(currency);
    await userEvent.type(currency, 'eur');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Allow shop' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body).toEqual({
      merchantOrigin: 'shop.example.test', frameOrigins: [], maxAmount: 75.5, currency: 'EUR',
      periodLimit: null, expiresAt: null, includeSecurityCode: false,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('sends a period limit, frames and the security code when set', async () => {
    const calls = handlers({ grants: [], requests: [] });
    render(panel(), { wrapperOptions: { user: mockUser } });
    await userEvent.click(await screen.findByRole('button', { name: 'Allow a shop' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Shop website/), 'https://shop.example.test');
    await userEvent.type(within(dialog).getByLabelText(/Most per purchase/), '20');
    await userEvent.type(within(dialog).getByLabelText(/Payment frames/), 'pay.example.test, https://psp.example.test');
    await userEvent.click(within(dialog).getByLabelText('Limit'));
    await userEvent.click(await screen.findByRole('option', { name: 'Per day' }));
    await userEvent.type(within(dialog).getByLabelText('Uses per day'), '2');
    await userEvent.click(within(dialog).getByRole('switch'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Allow shop' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body).toMatchObject({
      frameOrigins: ['pay.example.test', 'https://psp.example.test'], maxAmount: 20, currency: 'USD',
      periodLimit: { period: 'day', maxReleases: 2 }, includeSecurityCode: true,
    });
  });

  it('shows the API refusal in the form', async () => {
    handlers({ grants: [], requests: [], createStatus: 409 });
    render(panel(), { wrapperOptions: { user: mockUser } });
    await userEvent.click(await screen.findByRole('button', { name: 'Allow a shop' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Shop website/), 'shop.example.test');
    await userEvent.type(within(dialog).getByLabelText(/Most per purchase/), '10');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Allow shop' }));
    expect(await within(dialog).findByText('This card already has a live permission for that shop. Revoke it first.')).toBeInTheDocument();
  });

  it('is read-only without secrets:write: no Allow, Revoke, Approve or Decline, and the switch is disabled', async () => {
    handlers();
    render(panel({ canWrite: false }), { wrapperOptions: { user: mockUser } });
    await screen.findAllByTestId('card-grant');
    expect(screen.getByRole('switch', { name: 'Allow agents to use this card' })).toBeDisabled();
    for (const name of [/Allow a shop/, /Revoke/, /Approve/, /Decline/]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('calls onToggle with the new state', async () => {
    handlers({ grants: [], requests: [] });
    const onToggle = vi.fn();
    render(panel({ agentAccess: 'none', onToggle }), { wrapperOptions: { user: mockUser } });
    await userEvent.click(await screen.findByRole('switch', { name: 'Allow agents to use this card' }));
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});

describe('card grant helpers', () => {
  it('describes limits and maps error codes', () => {
    expect(describeGrantLimits({ maxAmount: 10, currency: 'USD', periodLimit: { period: 'day', maxReleases: null, maxAmount: 30 } })).toBe(
      'Up to 10.00 USD per purchase · 30.00 USD per day',
    );
    expect(cardGrantErrorMessage({ code: 'OWNER_SESSION_REQUIRED' })).toMatch(/Sign in to Vault/);
    expect(cardGrantErrorMessage({ code: 'CARD_GRANT_REQUEST_NOT_PENDING' })).toMatch(/already approved or declined/);
    expect(cardGrantErrorMessage(new Error('x'))).toBe('x');
  });
});
