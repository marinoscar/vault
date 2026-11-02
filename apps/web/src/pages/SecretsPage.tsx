import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, Snackbar, Typography } from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import {
  DataTablePreferencesProvider,
  type DataTablePreferencesPort,
  type DataTableSortState,
} from '@marinoscar/platform-web/datatable/headless';
import {
  SecretsTable,
  SECRETS_PAGE_SIZES,
  SECRETS_TABLE_ID,
  type SecretSortField,
} from '../components/secrets/SecretsTable';
import { useSecretTypes } from '../hooks/useSecretTypes';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';
import { dataTablePreferencesPort } from '../platform/dataTablePreferences';
import { deleteSecret, getSecrets } from '../services/api';
import type { SecretListItem } from '../types';

const SORT_FIELDS: readonly SecretSortField[] = ['name', 'updatedAt', 'createdAt'];
const DEFAULT_SORT: DataTableSortState = { field: 'updatedAt', direction: 'desc' };
const DEFAULT_PAGE_SIZE = 20;

/** The list's query as it lives in the URL (`?q=&type=&sort=&dir=&page=&size=`). */
interface ListQuery {
  search: string;
  typeId: string;
  sort: DataTableSortState;
  /** 1-based, as the API and the URL count. */
  page: number;
  pageSize: number;
}

function readQuery(params: URLSearchParams): ListQuery {
  const sortField = params.get('sort');
  const dir = params.get('dir');
  const page = Number(params.get('page'));
  const size = Number(params.get('size'));
  return {
    search: params.get('q') ?? '',
    typeId: params.get('type') ?? '',
    sort:
      sortField && (SORT_FIELDS as readonly string[]).includes(sortField)
        ? { field: sortField, direction: dir === 'asc' ? 'asc' : 'desc' }
        : DEFAULT_SORT,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: SECRETS_PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE,
  };
}

function writeQuery(q: ListQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (q.search) params.set('q', q.search);
  if (q.typeId) params.set('type', q.typeId);
  if (q.sort.field !== DEFAULT_SORT.field || q.sort.direction !== DEFAULT_SORT.direction) {
    params.set('sort', q.sort.field);
    params.set('dir', q.sort.direction);
  }
  if (q.page > 1) params.set('page', String(q.page));
  if (q.pageSize !== DEFAULT_PAGE_SIZE) params.set('size', String(q.pageSize));
  return params;
}

/**
 * The stored layout restores sort and page size through the page's callbacks.
 * A link that names them explicitly wins: the restored copy is stripped of
 * whatever the URL already says, so a shared view opens as it was shared.
 */
function urlWinsPort(
  base: DataTablePreferencesPort,
  tableId: string,
  explicit: { sort: boolean; size: boolean },
): DataTablePreferencesPort {
  if (!explicit.sort && !explicit.size) return base;
  return {
    save: (id, entry) => base.save(id, entry),
    async load() {
      const all = await base.load();
      const entry = all?.[tableId];
      if (!all || !entry || typeof entry !== 'object') return all;
      const copy = { ...(entry as Record<string, unknown>) };
      if (explicit.sort) delete copy.sort;
      if (explicit.size) delete copy.pageSize;
      return { ...all, [tableId]: copy };
    },
  };
}

type Toast = { severity: 'success' | 'error'; message: string };

/**
 * The Secrets destination (E10.4, issue #95): the server-driven list on the
 * platform `DataTable`, with search, type, sort and page in the URL so a
 * reload or a shared link keeps the view. Row values are never decrypted here.
 */
export default function SecretsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => readQuery(params), [params]);
  // Decided once per mount: only the URL the page was opened with may veto
  // the stored layout.
  const [preferencesPort] = useState(() =>
    urlWinsPort(dataTablePreferencesPort, SECRETS_TABLE_ID, {
      sort: params.has('sort'),
      size: params.has('size'),
    }),
  );
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission('secrets:write');
  const canDelete = hasPermission('secrets:delete');

  const { types, fetchTypes } = useSecretTypes();
  const [rows, setRows] = useState<SecretListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    fetchTypes();
  }, [fetchTypes]);

  useEffect(() => {
    // Only the latest request may write state: a slow response to an older
    // search must not overwrite the rows of the newer one.
    let current = true;
    setLoading(true);
    setError(null);
    getSecrets({
      page: query.page,
      pageSize: query.pageSize,
      search: query.search || undefined,
      typeId: query.typeId || undefined,
      sortBy: query.sort.field,
      sortOrder: query.sort.direction,
    })
      .then((response) => {
        if (!current) return;
        setRows(response.items);
        setTotal(response.meta.totalItems);
      })
      .catch((err: unknown) => {
        if (!current) return;
        setRows([]);
        setTotal(0);
        setError(err instanceof Error ? err.message : 'Failed to load secrets');
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [query, reloadKey]);

  const update = useCallback(
    (patch: Partial<ListQuery>, replace = false) => {
      setParams(writeQuery({ ...query, ...patch }), { replace });
    },
    [query, setParams],
  );

  const handleDelete = useCallback(
    async (row: SecretListItem) => {
      try {
        await deleteSecret(row.id);
        setToast({ severity: 'success', message: `Deleted "${row.name}"` });
        // Step back a page when the last row of a page was removed.
        if (rows.length === 1 && query.page > 1) update({ page: query.page - 1 });
        else setReloadKey((k) => k + 1);
      } catch (err) {
        setToast({
          severity: 'error',
          message: err instanceof Error ? err.message : 'Failed to delete secret',
        });
      }
    },
    [rows.length, query.page, update],
  );

  const openSecret = useCallback((row: SecretListItem) => navigate(`/secrets/${row.id}`), [navigate]);
  const editSecret = useCallback(
    (row: SecretListItem) => navigate(`/secrets/${row.id}/edit`),
    [navigate],
  );
  const renewCard = useCallback(
    (row: SecretListItem) => navigate(`/cards/${row.id}/renew`),
    [navigate],
  );
  const createSecret = useCallback(() => navigate('/secrets/new'), [navigate]);

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', minWidth: 0 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          mb: 2,
          minWidth: 0,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
            Secrets
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }} aria-live="polite">
            {loading && rows.length === 0
              ? 'Loading…'
              : `${total} ${total === 1 ? 'secret' : 'secrets'}${
                  query.search || query.typeId ? ' match' : ''
                }`}
          </Typography>
        </Box>
        {canWrite && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={createSecret}
            sx={{ flexShrink: 0, whiteSpace: 'nowrap', minHeight: 40 }}
          >
            New secret
          </Button>
        )}
      </Box>

      <DataTablePreferencesProvider port={preferencesPort}>
        <SecretsTable
          rows={rows}
          total={total}
          page={query.page - 1}
          pageSize={query.pageSize}
          loading={loading}
          error={error}
          sort={query.sort}
          onSortChange={(next) => update({ sort: next ?? DEFAULT_SORT, page: 1 })}
          onPaginationChange={(next) =>
            update({ page: next.page + 1, pageSize: next.pageSize })
          }
          search={query.search}
          onSearchChange={(search) => update({ search, page: 1 }, true)}
          typeId={query.typeId}
          onTypeChange={(typeId) => update({ typeId, page: 1 })}
          types={types}
          onClearFilters={() => update({ search: '', typeId: '', page: 1 })}
          onCreate={canWrite ? createSecret : undefined}
          onOpen={openSecret}
          onEdit={canWrite ? editSecret : undefined}
          onRenewCard={canWrite ? renewCard : undefined}
          onDelete={canDelete ? handleDelete : undefined}
        />
      </DataTablePreferencesProvider>

      <Snackbar
        open={!!toast}
        autoHideDuration={toast?.severity === 'error' ? null : 3000}
        onClose={() => setToast(null)}
      >
        <Alert severity={toast?.severity ?? 'success'} onClose={() => setToast(null)}>
          {toast?.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
