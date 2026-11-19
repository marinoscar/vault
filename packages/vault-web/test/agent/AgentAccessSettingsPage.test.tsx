import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, mockUser } from '../utils/test-utils.js';
import { server } from '../mocks/server.js';
import AgentAccessSettingsPage from '../../src/agent/ui/pages/AgentAccessSettingsPage.js';

const API_BASE = '*/api';
const READER = { ...mockUser, permissions: [...mockUser.permissions, 'system_settings:read'] };
const WRITER = { ...mockUser, permissions: [...mockUser.permissions, 'system_settings:read', 'system_settings:write'] };

const SETTINGS = {
  ui: { allowUserThemeOverride: true },
  features: {},
  ai: null,
  agentAccess: { enabled: false, lookupPerMinute: 60, fillPerMinute: 30, totpPerMinute: 10, writePerMinute: 10 },
  updatedAt: '2026-03-01T00:00:00Z',
  updatedBy: null,
  version: 3,
};

function handlers() {
  const patches: Record<string, unknown>[] = [];
  server.use(
    http.get(`${API_BASE}/system-settings`, () => HttpResponse.json({ data: SETTINGS })),
    http.patch(`${API_BASE}/system-settings`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      patches.push(body);
      return HttpResponse.json({ data: { ...SETTINGS, ...body, version: 4 } });
    }),
  );
  return patches;
}

describe('AgentAccessSettingsPage', () => {
  it('reads the namespace and saves the switch and limits', async () => {
    const patches = handlers();
    render(<AgentAccessSettingsPage />, { wrapperOptions: { user: WRITER } });
    const sw = await screen.findByRole('switch', { name: 'Allow agents to use opened logins' });
    expect(sw).not.toBeChecked();
    expect(screen.getByLabelText('Fills per minute')).toHaveValue(30);
    await userEvent.click(sw);
    const fill = screen.getByLabelText('Fills per minute');
    await userEvent.clear(fill);
    await userEvent.type(fill, '45');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({
      agentAccess: {
        enabled: true, lookupPerMinute: 60, fillPerMinute: 45, totpPerMinute: 10, writePerMinute: 10,
        cards: { enabled: false, fillPerMinute: 10, releasesPerCardPerDay: 5 },
        identity: { enabled: false, fillPerMinute: 20 },
      },
    });
  });

  it('shows the card and identity switches off by default and saves them with their limits (ADR-0003)', async () => {
    const patches = handlers();
    render(<AgentAccessSettingsPage />, { wrapperOptions: { user: WRITER } });
    const cards = await screen.findByRole('switch', { name: 'Allow agents to use cards' });
    const identity = screen.getByRole('switch', { name: 'Allow agents to fill identity details' });
    expect(cards).not.toBeChecked();
    expect(identity).not.toBeChecked();
    expect(screen.getByLabelText('Card uses per card per day')).toHaveValue(5);
    await userEvent.click(cards);
    const cap = screen.getByLabelText('Card uses per card per day');
    await userEvent.clear(cap);
    await userEvent.type(cap, '3');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toMatchObject({
      agentAccess: { enabled: false, cards: { enabled: true, fillPerMinute: 10, releasesPerCardPerDay: 3 }, identity: { enabled: false } },
    });
  });

  it('refuses an out-of-range limit', async () => {
    handlers();
    render(<AgentAccessSettingsPage />, { wrapperOptions: { user: WRITER } });
    const lookup = await screen.findByLabelText('Lookups per minute');
    await userEvent.clear(lookup);
    await userEvent.type(lookup, '9999');
    expect(screen.getByText('Enter a whole number from 1 to 600.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('is read-only without system_settings:write', async () => {
    handlers();
    render(<AgentAccessSettingsPage />, { wrapperOptions: { user: READER } });
    expect(await screen.findByRole('switch', { name: 'Allow agents to use opened logins' })).toBeDisabled();
    expect(screen.getByLabelText('Lookups per minute')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('falls back to the defaults when the API has no namespace yet', async () => {
    server.use(
      http.get(`${API_BASE}/system-settings`, () => HttpResponse.json({ data: { ...SETTINGS, agentAccess: undefined } })),
    );
    render(<AgentAccessSettingsPage />, { wrapperOptions: { user: READER } });
    expect(await screen.findByLabelText('Lookups per minute')).toHaveValue(60);
  });
});
