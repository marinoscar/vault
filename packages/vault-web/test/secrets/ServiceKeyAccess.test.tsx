import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render, mockUser, type MockUser } from '../utils/test-utils.js';
import { server } from '../mocks/server.js';
import SecretDetailPage from '../../src/secrets/ui/pages/SecretDetailPage.js';
import type { SecretType } from '../../src/core/headless/types.js';
import { AGENT_ACTION_LABELS, AGENT_ACTIVITY_ACTIONS } from '../../src/agent/headless/agentActivity.js';

// Service keys (issue #241): the switch that opens a key to the owner's apps, on the Service Key detail page.
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

const SERVICE_KEY: SecretType = {
  id: 'type-service-key', name: 'Service Key', description: null, icon: 'Api',
  fields: [
    { name: 'service', label: 'Service (for example web_search)', type: 'string', required: true, sensitive: false },
    { name: 'key_name', label: 'Key name (for example provider_a)', type: 'string', required: true, sensitive: false },
    { name: 'key', label: 'Key', type: 'string', required: true, sensitive: true },
  ],
  allowAttachments: false, isSystem: true, createdAt: '2026-01-01T00:00:00Z',
};

function detail(agentAccess: 'none' | 'fill') {
  return {
    id: SECRET_ID, name: 'Search key', description: null, type: SERVICE_KEY, currentVersion: 1,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
    agentAccess, agentAccessChangedAt: null,
    values: { service: 'web_search', key_name: 'provider_a', key: 'sk-placeholder' },
    createdBy: { id: 'u1', email: 'owner@example.test' }, attachments: [],
  };
}

const SWITCH = 'Allow your apps to use this service key';

describe('service key access switch', () => {
  it('opens the key with one PATCH and says so', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get(`${API_BASE}/secrets/${SECRET_ID}`, () => HttpResponse.json(detail('none'))),
      http.get(`${API_BASE}/secrets/${SECRET_ID}/versions`, () => HttpResponse.json([])),
      http.patch(`${API_BASE}/secrets/${SECRET_ID}/agent-access`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ data: detail('fill') });
      }),
    );
    const user = userEvent.setup();
    render(<SecretDetailPage />, { wrapperOptions: { user: WRITER } });
    const sw = await screen.findByRole('switch', { name: SWITCH });
    expect(sw).not.toBeChecked();
    expect(screen.getByText(/never shown to a chat assistant/)).toBeInTheDocument();
    // The login switch is not offered for a service key.
    expect(screen.queryByRole('switch', { name: 'Allow agents to use this login' })).not.toBeInTheDocument();
    await user.click(sw);
    await waitFor(() => expect(screen.getByRole('switch', { name: SWITCH })).toBeChecked());
    expect(bodies).toEqual([{ agentAccess: 'fill' }]);
    expect(await screen.findByText('Agents can now use this service key')).toBeInTheDocument();
  });

  it('labels the service key read in Agent activity', () => {
    expect(AGENT_ACTIVITY_ACTIONS).toContain('service_key');
    expect(AGENT_ACTION_LABELS.service_key).toBe('Service key read');
  });
});
