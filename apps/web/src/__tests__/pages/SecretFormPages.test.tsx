import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../utils/test-utils';
import { server } from '../mocks/server';
import CreateSecretPage from '../../pages/CreateSecretPage';
import EditSecretPage from '../../pages/EditSecretPage';
import type { SecretType } from '../../types';

const API_BASE = '*/api';
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate, useParams: () => ({ id: 'secret-1' }) };
});

const NOTE: SecretType = {
  id: '33333333-3333-4333-8333-333333333333', name: 'Secure Note', description: 'Free text', icon: 'Description',
  isSystem: true, allowAttachments: false, createdAt: '2026-01-01T00:00:00Z',
  fields: [{ name: 'content', label: 'Content', type: 'string', required: true, sensitive: false }],
};

beforeEach(() => mockNavigate.mockReset());

describe('CreateSecretPage', () => {
  it('posts the API contract unchanged and opens the new secret', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get(`${API_BASE}/secret-types`, () => HttpResponse.json({ data: [NOTE] })),
      http.post(`${API_BASE}/secrets`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ data: { id: 'new-id' } }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    render(<CreateSecretPage />);
    await user.click(await screen.findByRole('combobox', { name: /Type/ }));
    await user.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'Secure Note' }));
    await user.type(screen.getByLabelText(/^Name/), 'Wi-Fi guest network');
    await user.type(screen.getByLabelText(/^Content/), 'placeholder text');
    await user.click(screen.getByRole('button', { name: 'Create secret' }));

    await waitFor(() =>
      expect(bodies).toEqual([
        { name: 'Wi-Fi guest network', typeId: NOTE.id, data: { content: 'placeholder text' } },
      ]),
    );
    expect(mockNavigate).toHaveBeenCalledWith('/secrets/new-id');
  });
});

describe('EditSecretPage', () => {
  it('prefills the form and puts the edited values, clearing an emptied description', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get(`${API_BASE}/secrets/secret-1`, () =>
        HttpResponse.json({
          data: {
            id: 'secret-1', name: 'Wi-Fi guest network', description: 'Office', type: NOTE, currentVersion: 1,
            createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
            values: { content: 'old text' }, createdBy: null, attachments: [],
          },
        }),
      ),
      http.put(`${API_BASE}/secrets/secret-1`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ data: { id: 'secret-1' } });
      }),
    );
    const user = userEvent.setup();
    render(<EditSecretPage />);
    const content = await screen.findByLabelText(/^Content/);
    expect(content).toHaveValue('old text');
    expect(screen.queryByRole('combobox', { name: /Type/ })).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText(/^Description/));
    await user.clear(content);
    await user.type(content, 'new text');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(bodies).toEqual([{ name: 'Wi-Fi guest network', description: null, data: { content: 'new text' } }]),
    );
    expect(mockNavigate).toHaveBeenCalledWith('/secrets/secret-1');
  });

  it('blocks a save that would blank a required field', async () => {
    const puts: unknown[] = [];
    server.use(
      http.get(`${API_BASE}/secrets/secret-1`, () =>
        HttpResponse.json({
          data: {
            id: 'secret-1', name: 'Note', description: null, type: NOTE, currentVersion: 1,
            createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
            values: { content: 'x' }, createdBy: null, attachments: [],
          },
        }),
      ),
      http.put(`${API_BASE}/secrets/secret-1`, () => {
        puts.push(1);
        return HttpResponse.json({ data: {} });
      }),
    );
    const user = userEvent.setup();
    render(<EditSecretPage />);
    await user.clear(await screen.findByLabelText(/^Content/));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Content is required')).toBeInTheDocument();
    expect(puts).toHaveLength(0);
  });
});
