/**
 * Table layouts are the platform default (#153): with no
 * `DataTablePreferencesProvider` mounted, every `DataTable` keeps its layout
 * (visible columns, density, sort, page size) in the `dataTables` namespace of
 * `/api/user-settings` through the platform host's client, never in
 * `localStorage`. The wrapper mounts what `App.tsx` mounts (the platform host,
 * no preferences provider). The rail's `navigation` twin is pinned in
 * components/common/Layout.test.tsx.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  useDataTableLayoutPrefs,
  useDataTablePreferencesPort,
  type DataTableColumn,
} from '@marinoscar/platform-web/datatable/headless';

import { server } from '../mocks/server';
import { render, screen } from '../utils/test-utils';

interface Row {
  id: string;
  name: string;
  type: string;
}

const COLUMNS: DataTableColumn<Row>[] = [
  { id: 'name', label: 'Name', priority: 'primary' },
  { id: 'type', label: 'Type', priority: 'secondary' },
];

const TABLE_ID = 'probe-table';

function LayoutProbe() {
  const prefs = useDataTableLayoutPrefs<Row>({ tableId: TABLE_ID, columns: COLUMNS, layout: 'desktop' });
  return (
    <div>
      <p data-testid="density">{prefs.density}</p>
      <p data-testid="hydrated">{String(prefs.hydrated)}</p>
      <p data-testid="visible">{[...prefs.userVisibleColumnIds].sort().join(',')}</p>
      <button type="button" onClick={() => prefs.setDensity('compact')}>
        Compact
      </button>
      <button type="button" onClick={() => prefs.toggleColumn('type', false)}>
        Hide type
      </button>
    </div>
  );
}

function PortProbe() {
  const port = useDataTablePreferencesPort();
  return <p data-testid="port">{port ? 'server' : 'none'}</p>;
}

function settingsWith(extra: Record<string, unknown> = {}) {
  return { theme: 'system', profile: {}, version: 1, ...extra };
}

afterEach(() => window.localStorage.clear());

describe('DataTable layout preferences (platform default over /user-settings)', () => {
  it('resolves the platform user-settings port from the host, with no provider mounted', () => {
    render(<PortProbe />);
    expect(screen.getByTestId('port')).toHaveTextContent('server');
  });

  it('restores a stored layout from the dataTables namespace of GET /user-settings', async () => {
    server.use(
      http.get('*/api/user-settings', () =>
        HttpResponse.json({
          data: settingsWith({ dataTables: { [TABLE_ID]: { density: 'comfortable', visibleColumns: ['name', '-type'] } } }),
        }),
      ),
    );
    render(<LayoutProbe />);

    await waitFor(() => expect(screen.getByTestId('hydrated')).toHaveTextContent('true'));
    expect(screen.getByTestId('density')).toHaveTextContent('comfortable');
    expect(screen.getByTestId('visible')).toHaveTextContent(/^name$/);
  });

  it('persists a density and a column change as one PATCH of the table entry', async () => {
    const patches: Array<{ body: unknown; ifMatch: string | null }> = [];
    server.use(
      http.get('*/api/user-settings', () => HttpResponse.json({ data: settingsWith() })),
      http.patch('*/api/user-settings', async ({ request }) => {
        patches.push({ body: await request.json(), ifMatch: request.headers.get('if-match') });
        return HttpResponse.json({ data: settingsWith({ version: 2 }) });
      }),
    );
    render(<LayoutProbe />);
    await waitFor(() => expect(screen.getByTestId('hydrated')).toHaveTextContent('true'));

    fireEvent.click(screen.getByRole('button', { name: 'Compact' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide type' }));
    // In-session state applies at once; the write is debounced into one request.
    expect(screen.getByTestId('density')).toHaveTextContent('compact');
    expect(screen.getByTestId('visible')).toHaveTextContent(/^name$/);

    await waitFor(() => expect(patches).toHaveLength(1), { timeout: 3000 });
    expect(patches[0].body).toEqual({
      dataTables: { [TABLE_ID]: expect.objectContaining({ density: 'compact', visibleColumns: ['name', '-type'] }) },
    });
    // Fire-and-forget backup of one entry: no version check.
    expect(patches[0].ifMatch).toBeNull();
    expect(window.localStorage.getItem('vault.datatable.preferences')).toBeNull();
  });
});
