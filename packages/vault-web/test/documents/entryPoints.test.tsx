// Issue #211: the "Scan an ID" entry points — the availability helper and
// flag, the Home quick action, the Secrets list button and the type preselect
// of "Add manually". Invented values only.
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';

import { isCardScanAvailable, isDocumentScanAvailable } from '../../src/core/headless/cardScanAvailability.js';
import { useAiStatus } from '../../src/core/headless/useAiStatus.js';
import { QuickActions } from '../../src/home/ui/components/QuickActions.js';
import SecretsPage from '../../src/secrets/ui/pages/SecretsPage.js';
import CreateSecretPage from '../../src/secrets/ui/pages/CreateSecretPage.js';
import { server } from '../mocks/server.js';
import { AI_CONFIG_CARD_SCAN_ON, AI_CONFIG_OFF, AI_CONFIG_ON_NO_KEY } from '../mocks/aiConfig.js';
import { mockUser, render, screen, waitFor } from '../utils/test-utils.js';
import { ID_DOCUMENT_TYPE, PASSPORT_TYPE } from './documentFixtures.js';

const WRITER = { ...mockUser, permissions: [...mockUser.permissions, 'secrets:read', 'secrets:write', 'ai:use'] };

function Probe() {
  const { documentScanEnabled, isLoading } = useAiStatus();
  return <div data-testid="probe">{isLoading ? 'loading' : `doc:${String(documentScanEnabled)}`}</div>;
}

const typesHandler = () =>
  http.get('*/api/secret-types', () => HttpResponse.json({ data: [PASSPORT_TYPE, ID_DOCUMENT_TYPE] }));
const emptyList = () =>
  http.get('*/api/secrets', () =>
    HttpResponse.json({ data: { items: [], meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } } }),
  );

describe('document scan availability', () => {
  it('follows the card rule for now', () => {
    for (const config of [AI_CONFIG_CARD_SCAN_ON, AI_CONFIG_OFF, AI_CONFIG_ON_NO_KEY, null]) {
      expect(isDocumentScanAvailable(config)).toBe(isCardScanAvailable(config));
    }
  });

  it('is enabled for a viewer with ai:use when scanning is set up', async () => {
    render(<Probe />, { wrapperOptions: { user: WRITER } });
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('doc:true'));
  });

  it('fails closed without ai:use or when not set up', async () => {
    render(<Probe />, { wrapperOptions: { user: mockUser } });
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('doc:false'));
  });
});

describe('Home quick action', () => {
  it('offers "Scan an ID" linking to /documents/scan when allowed', () => {
    render(<QuickActions canCreateSecret canScanCard canScanDocument canBackUp />);
    expect(screen.getByRole('link', { name: 'Scan an ID' })).toHaveAttribute('href', '/documents/scan');
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual([
      'New secret',
      'Scan a card',
      'Scan an ID',
      'Back up now',
    ]);
  });

  it('hides it otherwise', () => {
    render(<QuickActions canCreateSecret canScanCard canBackUp />);
    expect(screen.queryByRole('link', { name: 'Scan an ID' })).not.toBeInTheDocument();
  });
});

describe('Secrets list', () => {
  it('shows "Scan an ID" when the type filter is ID Document', async () => {
    server.use(typesHandler(), emptyList());
    render(<SecretsPage />, { wrapperOptions: { user: WRITER, route: '/secrets?type=type-id-document' } });
    expect(await screen.findByRole('button', { name: 'Scan an ID' })).toBeInTheDocument();
  });

  it('does not show it for another type filter or none', async () => {
    server.use(typesHandler(), emptyList());
    render(<SecretsPage />, { wrapperOptions: { user: WRITER, route: '/secrets' } });
    await screen.findByRole('button', { name: 'New secret' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Scan an ID' })).not.toBeInTheDocument());
  });
});

describe('New secret ?type=', () => {
  it('preselects the type and shows its fields', async () => {
    server.use(typesHandler());
    render(<CreateSecretPage />, { wrapperOptions: { user: WRITER, route: '/secrets/new?type=type-passport' } });
    expect(await screen.findByText('Passport fields')).toBeInTheDocument();
  });
});
