import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render, mockUser, type MockUser } from '../utils/test-utils.js';
import { server } from '../mocks/server.js';
import { IdentityAgentAccessPanel, toOrigin } from '../../src/agent/ui/components/IdentityAgentAccessPanel.js';
import { AGENT_ACTION_LABELS, AGENT_ACTIVITY_ACTIONS, agentAppLabel } from '../../src/agent/headless/agentActivity.js';
import SecretDetailPage from '../../src/secrets/ui/pages/SecretDetailPage.js';
import type { SecretType } from '../../src/core/headless/types.js';

const API_BASE = '*/api';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn(), useParams: () => ({ id: 'secret-1' }) };
});

const props = (over: Partial<Parameters<typeof IdentityAgentAccessPanel>[0]> = {}) => ({
  agentAccess: 'fill' as const,
  agentOrigins: ['https://form.example.test'],
  canWrite: true,
  onSave: vi.fn().mockResolvedValue(undefined),
  errorMessage: (err: unknown) => (err instanceof Error ? err.message : 'failed'),
  ...over,
});

describe('IdentityAgentAccessPanel', () => {
  it('lists the allowed websites, adds a normalized one and saves the list with the access', async () => {
    const p = props();
    render(<IdentityAgentAccessPanel {...p} />, { wrapperOptions: { user: mockUser } });
    expect(screen.getByText('https://form.example.test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Add a website'), 'Apply.Example.Test/path');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('https://apply.example.test')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(p.onSave).toHaveBeenCalledWith('fill', ['https://apply.example.test', 'https://form.example.test']));
  });

  it('refuses a non-https website and removes one with its chip', async () => {
    const p = props();
    render(<IdentityAgentAccessPanel {...p} />, { wrapperOptions: { user: mockUser } });
    await userEvent.type(screen.getByLabelText('Add a website'), 'http://form.example.test');
    expect(screen.getByText('Enter an https website, for example form.example.test.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    const chip = screen.getByText('https://form.example.test').closest('.MuiChip-root')!;
    await userEvent.click(chip.querySelector('.MuiChip-deleteIcon')!);
    expect(screen.getByText('None: these two fields are never filled.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(p.onSave).toHaveBeenCalledWith('fill', []));
  });

  it('toggles access without sending origins, and shows a refusal', async () => {
    const p = props({ agentAccess: 'none', onSave: vi.fn().mockRejectedValue(new Error('Sign in to Vault')) });
    render(<IdentityAgentAccessPanel {...p} />, { wrapperOptions: { user: mockUser } });
    await userEvent.click(screen.getByRole('switch', { name: 'Allow agents to fill these details' }));
    expect(p.onSave).toHaveBeenCalledWith('fill', undefined);
    expect(await screen.findByText('Sign in to Vault')).toBeInTheDocument();
  });

  it('is read-only without secrets:write', () => {
    render(<IdentityAgentAccessPanel {...props({ canWrite: false })} />, { wrapperOptions: { user: mockUser } });
    expect(screen.getByRole('switch', { name: 'Allow agents to fill these details' })).toBeDisabled();
    expect(screen.queryByLabelText('Add a website')).not.toBeInTheDocument();
  });

  it('toOrigin keeps the origin only and refuses http', () => {
    expect(toOrigin('https://Form.Example.Test:8443/x?y=1')).toBe('https://form.example.test:8443');
    expect(toOrigin('http://form.example.test')).toBeNull();
    expect(toOrigin('not a site')).toBeNull();
  });
});

const WRITER: MockUser = { ...mockUser, permissions: [...mockUser.permissions, 'secrets:read', 'secrets:write'] };

function type(name: string): SecretType {
  return {
    id: `type-${name}`, name, description: null, icon: 'Badge',
    fields: [{ name: 'full_name', label: 'Full Legal Name', type: 'string', required: true, sensitive: false }],
    allowAttachments: name === 'Card', isSystem: true, createdAt: '2026-01-01T00:00:00Z',
  };
}

function detailHandlers(typeName: string) {
  const patches: unknown[] = [];
  server.use(
    http.get(`${API_BASE}/secrets/secret-1`, () =>
      HttpResponse.json({
        id: 'secret-1', name: `${typeName} A`, description: null, type: type(typeName), currentVersion: 1,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', agentAccess: 'none', agentAccessChangedAt: null,
        agentOrigins: [], values: { full_name: 'Person A' }, createdBy: { id: 'u1', email: 'owner@example.test' }, attachments: [],
      })),
    http.get(`${API_BASE}/secrets/secret-1/versions`, () => HttpResponse.json([])),
    http.get(`${API_BASE}/secrets/secret-1/attachments`, () => HttpResponse.json([])),
    http.get(`${API_BASE}/secrets/secret-1/card-grants`, () => HttpResponse.json({ data: [] })),
    http.get(`${API_BASE}/secrets/secret-1/card-grant-requests`, () => HttpResponse.json({ data: [] })),
    http.patch(`${API_BASE}/secrets/secret-1/agent-access`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      patches.push(body);
      return HttpResponse.json({ data: { agentAccess: body.agentAccess, agentAccessChangedAt: '2026-03-01T00:00:00Z', agentOrigins: body.allowedOrigins ?? [] } });
    }),
  );
  return patches;
}

describe('SecretDetailPage agent access by type (ADR-0003)', () => {
  it('shows the card panel on a Card and opens it', async () => {
    const patches = detailHandlers('Card');
    render(<SecretDetailPage />, { wrapperOptions: { user: WRITER } });
    const sw = await screen.findByRole('switch', { name: 'Allow agents to use this card' });
    expect(screen.queryByRole('switch', { name: 'Allow agents to use this login' })).not.toBeInTheDocument();
    await userEvent.click(sw);
    await waitFor(() => expect(patches).toEqual([{ agentAccess: 'fill' }]));
    expect(await screen.findByText('Agents can now use this card')).toBeInTheDocument();
  });

  it('shows the identity panel on an Identity and saves its websites', async () => {
    const patches = detailHandlers('Identity');
    render(<SecretDetailPage />, { wrapperOptions: { user: WRITER } });
    await screen.findByRole('switch', { name: 'Allow agents to fill these details' });
    await userEvent.type(screen.getByLabelText('Add a website'), 'form.example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches).toEqual([{ agentAccess: 'none', allowedOrigins: ['https://form.example.test'] }]));
  });
});

describe('agent activity labels', () => {
  it('labels every action, and names an embedded host by its label', () => {
    for (const action of AGENT_ACTIVITY_ACTIONS) expect(AGENT_ACTION_LABELS[action]).toBeTruthy();
    expect(AGENT_ACTIVITY_ACTIONS).toContain('card_fill');
    expect(agentAppLabel({ clientName: 'Host A', credentialKind: 'embedded' })).toBe('Host A');
  });
});
