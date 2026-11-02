import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Avatar, Box, Button, Chip, Link, MenuItem, TextField, Tooltip, Typography } from '@mui/material';
import {
  Add as AddIcon,
  DeleteOutlined as DeleteIcon,
  EditOutlined as EditIcon,
  OpenInNew as OpenIcon,
  Autorenew as RenewIcon,
  KeyOutlined as EmptyIcon,
  SearchOff as NoMatchIcon,
} from '@mui/icons-material';
import { DataTable, QuickSearchField } from '@marinoscar/platform-web/datatable/ui';
import type {
  DataTableColumn,
  DataTableLayout,
  DataTableRendererMode,
  DataTableToolbarSlotProps,
  DataTableRowAction,
  DataTableSortState,
} from '@marinoscar/platform-web/datatable/headless';
import { SecretTypeIcon } from './SecretTypeIcon.js';
import { formatRelativeTime, isCardType } from '../../headless/secretFields.js';
import type { SecretListItem, SecretType } from '../../../core/headless/types.js';

/** The `sortBy` values `GET /api/secrets` accepts, which are also column ids. */
export type SecretSortField = 'name' | 'updatedAt' | 'createdAt';

export const SECRETS_TABLE_ID = 'secrets';
export const SECRETS_PAGE_SIZES = [10, 20, 50, 100];

export interface SecretsTableProps {
  rows: SecretListItem[];
  total: number;
  /** 0-based, as the platform table counts. */
  page: number;
  pageSize: number;
  loading: boolean;
  error: string | null;
  sort: DataTableSortState | null;
  onSortChange: (next: DataTableSortState | null) => void;
  onPaginationChange: (next: { page: number; pageSize: number }) => void;
  search: string;
  onSearchChange: (value: string) => void;
  typeId: string;
  onTypeChange: (typeId: string) => void;
  types: SecretType[];
  onClearFilters: () => void;
  /** Shown when the user may create (`secrets:write`). */
  onCreate?: () => void;
  onOpen: (row: SecretListItem) => void;
  /** Shown when the user may edit (`secrets:write`). */
  onEdit?: (row: SecretListItem) => void;
  /** Card-type rows only; shown when the user may edit. */
  onRenewCard?: (row: SecretListItem) => void;
  /** Shown when the user may delete (`secrets:delete`); confirmed by the table first. */
  onDelete?: (row: SecretListItem) => void;
  /** Forces a layout; `auto` (the default) measures the table's container. */
  renderer?: DataTableRendererMode;
}

function TypeAvatar({ row, size = 32 }: { row: SecretListItem; size?: number }) {
  return (
    <Avatar
      variant="rounded"
      aria-hidden
      sx={{ width: size, height: size, flexShrink: 0, bgcolor: 'action.selected', color: 'primary.main' }}
    >
      <SecretTypeIcon icon={row.type.icon} fontSize="small" />
    </Avatar>
  );
}

function NameLink({ row }: { row: SecretListItem }) {
  return (
    <Link
      component={RouterLink}
      to={`/secrets/${row.id}`}
      underline="hover"
      sx={{ fontWeight: 600, color: 'text.primary', overflowWrap: 'anywhere' }}
    >
      {row.name}
    </Link>
  );
}

function TypeChip({ row }: { row: SecretListItem }) {
  return (
    <Chip
      icon={<SecretTypeIcon icon={row.type.icon} fontSize="small" />}
      label={row.type.name}
      size="small"
      variant="outlined"
    />
  );
}

function UpdatedLabel({ iso }: { iso: string }) {
  return (
    <Tooltip title={new Date(iso).toLocaleString()}>
      <span>{formatRelativeTime(iso)}</span>
    </Tooltip>
  );
}

/**
 * The table's layout reaches the page through the Toolbar slot (the platform
 * measures the container; this app reads no breakpoint). A slot is a
 * component, so the setter travels by context to keep its identity stable.
 */
const LayoutReport = createContext<((layout: DataTableLayout) => void) | null>(null);

function LayoutProbe({ layout }: DataTableToolbarSlotProps<SecretListItem>) {
  const report = useContext(LayoutReport);
  useEffect(() => report?.(layout), [report, layout]);
  return null;
}

const SLOTS = { Toolbar: LayoutProbe };

/** Grid columns (desktop and tablet): one fact per column. */
const GRID_COLUMNS: DataTableColumn<SecretListItem>[] = [
  {
    id: 'name',
    label: 'Name',
    priority: 'primary',
    sortable: true,
    hideable: false,
    flex: 1.4,
    minWidth: 220,
    value: (row) => row.name,
    render: (row) => (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, height: '100%' }}>
        <TypeAvatar row={row} size={28} />
        <Box sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <NameLink row={row} />
        </Box>
      </Box>
    ),
  },
  {
    id: 'description',
    label: 'Description',
    priority: 'secondary',
    flex: 1.6,
    minWidth: 160,
    truncate: true,
    value: (row) => row.description ?? '',
    render: (row) =>
      row.description ? (
        <Typography variant="body2" component="span" sx={{ color: 'text.secondary' }}>
          {row.description}
        </Typography>
      ) : (
        <Typography variant="body2" component="span" sx={{ color: 'text.disabled' }} aria-label="No description">
          —
        </Typography>
      ),
  },
  {
    id: 'type',
    label: 'Type',
    priority: 'secondary',
    width: 160,
    value: (row) => row.type.name,
    render: (row) => <TypeChip row={row} />,
  },
  {
    id: 'currentVersion',
    label: 'Version',
    priority: 'detail',
    width: 96,
    value: (row) => `v${row.currentVersion}`,
  },
  {
    id: 'updatedAt',
    label: 'Updated',
    priority: 'secondary',
    sortable: true,
    width: 130,
    value: (row) => formatRelativeTime(row.updatedAt),
    render: (row) => <UpdatedLabel iso={row.updatedAt} />,
  },
];

/**
 * Card columns (phone): the headline carries everything, so a card is a
 * compact block (name, description, then type, age and version on one line)
 * instead of a stack of label/value pairs. Same ids, so sort and the stored
 * layout carry across a resize.
 */
const CARD_COLUMNS: DataTableColumn<SecretListItem>[] = [
  {
    id: 'name',
    label: 'Name',
    priority: 'primary',
    sortable: true,
    hideable: false,
    value: (row) => row.name,
    render: (row) => (
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, minWidth: 0 }}>
        <TypeAvatar row={row} size={36} />
        <Box sx={{ minWidth: 0 }}>
          <NameLink row={row} />
          {row.description && (
            <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 400, overflowWrap: 'anywhere' }}>
              {row.description}
            </Typography>
          )}
        </Box>
      </Box>
    ),
  },
  {
    id: 'updatedAt',
    label: 'Updated',
    priority: 'primary',
    sortable: true,
    value: (row) => formatRelativeTime(row.updatedAt),
    render: (row) => (
      <Box
        sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, pl: 6, pt: 0.5 }}
      >
        <TypeChip row={row} />
        <span>
          Updated <UpdatedLabel iso={row.updatedAt} /> · v{row.currentVersion}
        </span>
      </Box>
    ),
  },
];

/**
 * The Secrets list on the platform `DataTable` (E10.4, issue #95): a grid on
 * desktop and tablet, a card list on a phone (the table measures its own
 * container, so this component reads no breakpoint). Server-driven: sort,
 * page and filters are the page's, the table only reports changes. No secret
 * value is ever in a row (list responses are not decrypted).
 */
export function SecretsTable(props: SecretsTableProps) {
  const {
    rows,
    total,
    page,
    pageSize,
    loading,
    error,
    sort,
    onSortChange,
    onPaginationChange,
    search,
    onSearchChange,
    typeId,
    onTypeChange,
    types,
    onClearFilters,
    onCreate,
    onOpen,
    onEdit,
    onRenewCard,
    onDelete,
    renderer,
  } = props;

  const [layout, setLayout] = useState<DataTableLayout>(
    renderer && renderer !== 'auto' ? renderer : 'desktop',
  );
  const columns = layout === 'mobile' ? CARD_COLUMNS : GRID_COLUMNS;

  const rowActions = useMemo<DataTableRowAction<SecretListItem>[]>(() => {
    const actions: DataTableRowAction<SecretListItem>[] = [
      { id: 'open', label: 'Open', icon: <OpenIcon fontSize="small" />, onClick: onOpen },
    ];
    if (onEdit) {
      actions.push({ id: 'edit', label: 'Edit', icon: <EditIcon fontSize="small" />, onClick: onEdit });
    }
    if (onRenewCard) {
      actions.push({
        id: 'renew',
        label: 'Renew card',
        icon: <RenewIcon fontSize="small" />,
        onClick: onRenewCard,
        disabled: (row) => !isCardType(row.type),
        disabledReason: (row) => (isCardType(row.type) ? undefined : 'Only card secrets can be renewed'),
      });
    }
    if (onDelete) {
      actions.push({
        id: 'delete',
        label: 'Delete',
        icon: <DeleteIcon fontSize="small" />,
        destructive: true,
        onClick: onDelete,
        confirm: {
          title: 'Delete secret?',
          description: (row) =>
            `"${row.name}" and all of its versions will be permanently deleted. This cannot be undone.`,
          confirmLabel: 'Delete',
        },
      });
    }
    return actions;
  }, [onOpen, onEdit, onRenewCard, onDelete]);

  const hasQuery = search !== '' || typeId !== '';

  const emptyState = hasQuery ? (
    <Box sx={{ py: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
      <NoMatchIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        No secrets match your filters
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        Try another name or type.
      </Typography>
      <Button onClick={onClearFilters} sx={{ mt: 1 }}>
        Clear filters
      </Button>
    </Box>
  ) : (
    <Box sx={{ py: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
      <Avatar sx={{ width: 56, height: 56, bgcolor: 'action.selected', color: 'primary.main' }}>
        <EmptyIcon />
      </Avatar>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mt: 1 }}>
        No secrets yet
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 360 }}>
        Store logins, API keys, cards and notes. Every value is encrypted and versioned.
      </Typography>
      {onCreate && (
        <Button variant="contained" startIcon={<AddIcon />} onClick={onCreate} sx={{ mt: 1 }}>
          Create your first secret
        </Button>
      )}
    </Box>
  );

  return (
    <Box sx={{ minWidth: 0 }}>
      <Box
        role="search"
        aria-label="Filter secrets"
        sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 2, minWidth: 0 }}
      >
        <Box sx={{ flex: '3 1 260px', minWidth: 0 }}>
          <QuickSearchField
            config={{
              value: search,
              onChange: onSearchChange,
              placeholder: 'Search by name',
              ariaLabel: 'Search secrets',
            }}
            columns={columns}
            fullWidth
          />
        </Box>
        <TextField
          select
          size="small"
          label="Type"
          value={typeId}
          onChange={(e) => onTypeChange(e.target.value)}
          sx={{ flex: '1 1 180px', minWidth: 0, '& .MuiInputBase-root': { minHeight: 44 } }}
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
        >
          <MenuItem value="">All types</MenuItem>
          {types.map((type) => (
            <MenuItem key={type.id} value={type.id}>
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                <SecretTypeIcon icon={type.icon} fontSize="small" />
                {type.name}
              </Box>
            </MenuItem>
          ))}
        </TextField>
      </Box>

      <LayoutReport.Provider value={setLayout}>
      <DataTable<SecretListItem>
        tableId={SECRETS_TABLE_ID}
        ariaLabel="Secrets"
        columns={columns}
        rows={rows}
        rowId={(row) => row.id}
        loading={loading}
        error={error}
        emptyState={emptyState}
        sort={{ sort, onSortChange }}
        pagination={{
          page,
          pageSize,
          total,
          onPaginationChange,
          pageSizeOptions: SECRETS_PAGE_SIZES,
        }}
        rowActions={rowActions}
        disableExport
        renderer={renderer}
        // The grid has five narrow columns: it fits whole from 840px, so the
        // tablet fold (Version behind a row expander) starts below that.
        tabletBreakpoint={840}
        slots={SLOTS}
      />
      </LayoutReport.Provider>
    </Box>
  );
}
