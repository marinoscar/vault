import { createContext, useContext, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Chip, Link, Tooltip, Typography } from '@mui/material';
import { SmartToyOutlined as EmptyIcon } from '@mui/icons-material';
import { DataTable } from '@marinoscar/platform-web/datatable/ui';
import type {
  DataTableColumn,
  DataTableLayout,
  DataTableRendererMode,
  DataTableToolbarSlotProps,
} from '@marinoscar/platform-web/datatable/headless';
import {
  AGENT_ACTION_LABELS,
  agentAppLabel,
  type AgentActivityItem,
} from '../../headless/agentActivity.js';

export const AGENT_ACTIVITY_TABLE_ID = 'agent-activity';
export const AGENT_ACTIVITY_PAGE_SIZES = [10, 25, 50, 100];

export interface AgentActivityTableProps {
  rows: AgentActivityItem[];
  total: number;
  /** 0-based, as the platform table counts. */
  page: number;
  pageSize: number;
  loading: boolean;
  error: string | null;
  onPaginationChange: (next: { page: number; pageSize: number }) => void;
  /** True when a filter is active, so the empty state says "no match". */
  filtered?: boolean;
  renderer?: DataTableRendererMode;
}

const LayoutReport = createContext<((layout: DataTableLayout) => void) | null>(null);

function LayoutProbe({ layout }: DataTableToolbarSlotProps<AgentActivityItem>) {
  const report = useContext(LayoutReport);
  useEffect(() => report?.(layout), [report, layout]);
  return null;
}

const SLOTS = { Toolbar: LayoutProbe };

function Dash() {
  return (
    <Typography variant="body2" component="span" sx={{ color: 'text.disabled' }} aria-label="None">
      —
    </Typography>
  );
}

function ResultChip({ row }: { row: AgentActivityItem }) {
  if (row.result === 'ok') return <Chip size="small" color="success" variant="outlined" label="OK" />;
  const chip = <Chip size="small" color="error" variant="outlined" label="Denied" />;
  return row.reason ? (
    <Tooltip title={row.reason}>
      <span tabIndex={0} aria-label={`Denied: ${row.reason}`}>
        {chip}
      </span>
    </Tooltip>
  ) : (
    chip
  );
}

function SecretLink({ row }: { row: AgentActivityItem }) {
  if (!row.secretId) return <Dash />;
  return (
    <Link
      component={RouterLink}
      to={`/secrets/${row.secretId}`}
      underline="hover"
      sx={{ overflowWrap: 'anywhere' }}
    >
      {row.secretName ?? 'Secret'}
    </Link>
  );
}

/** `Service: web_search/provider_a` for a service key call; empty otherwise. */
function serviceKeyLabel(row: AgentActivityItem): string {
  if (!row.service) return '';
  return `Service: ${row.service}${row.keyName ? `/${row.keyName}` : ''}`;
}

function TimeLabel({ iso }: { iso: string }) {
  return <time dateTime={iso}>{new Date(iso).toLocaleString()}</time>;
}

const COLUMNS: DataTableColumn<AgentActivityItem>[] = [
  {
    id: 'at',
    label: 'Time',
    priority: 'primary',
    hideable: false,
    width: 180,
    value: (row) => new Date(row.at).toLocaleString(),
    render: (row) => <TimeLabel iso={row.at} />,
  },
  {
    id: 'app',
    label: 'App',
    priority: 'primary',
    flex: 1,
    minWidth: 140,
    value: (row) => agentAppLabel(row),
  },
  {
    id: 'action',
    label: 'Action',
    priority: 'secondary',
    width: 130,
    value: (row) => AGENT_ACTION_LABELS[row.action] ?? row.action,
  },
  {
    id: 'secret',
    label: 'Secret',
    priority: 'secondary',
    flex: 1,
    minWidth: 140,
    value: (row) => row.secretName ?? '',
    render: (row) => <SecretLink row={row} />,
  },
  {
    id: 'origin',
    label: 'Website',
    priority: 'secondary',
    flex: 1,
    minWidth: 140,
    truncate: true,
    // A service key call (#241) has no website: the service and key name it read stand in.
    value: (row) => row.origin ?? serviceKeyLabel(row),
    render: (row) =>
      row.origin ? <span>{row.origin}</span> : serviceKeyLabel(row) ? <span>{serviceKeyLabel(row)}</span> : <Dash />,
  },
  {
    id: 'amount',
    label: 'Amount',
    priority: 'detail',
    width: 120,
    value: (row) => (row.amount ? `${row.amount} ${row.currency ?? ''}`.trim() : ''),
    render: (row) => (row.amount ? <span>{`${row.amount} ${row.currency ?? ''}`.trim()}</span> : <Dash />),
  },
  {
    id: 'purpose',
    label: 'Purpose',
    priority: 'detail',
    flex: 1.2,
    minWidth: 160,
    truncate: true,
    value: (row) => row.purpose ?? '',
    render: (row) => (row.purpose ? <span>{row.purpose}</span> : <Dash />),
  },
  {
    id: 'result',
    label: 'Result',
    priority: 'primary',
    width: 110,
    value: (row) => (row.result === 'ok' ? 'OK' : 'Denied'),
    render: (row) => <ResultChip row={row} />,
  },
];

/**
 * The agent activity list on the platform `DataTable`: a grid on desktop, cards on a phone (the
 * table measures its own container). Server-paged; no value, code or seed is ever in a row.
 */
export function AgentActivityTable(props: AgentActivityTableProps) {
  const { rows, total, page, pageSize, loading, error, onPaginationChange, filtered = false, renderer } = props;
  const [, setLayout] = useState<DataTableLayout>('desktop');

  const emptyState = (
    <Box sx={{ py: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, textAlign: 'center' }}>
      <EmptyIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
      <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 420 }}>
        {filtered
          ? 'No agent activity matches your filters.'
          : "No agent activity yet. Agents only see the logins, cards and identity details you allow on the secret's page."}
      </Typography>
    </Box>
  );

  return (
    <Box sx={{ minWidth: 0 }}>
      <LayoutReport.Provider value={setLayout}>
        <DataTable<AgentActivityItem>
          tableId={AGENT_ACTIVITY_TABLE_ID}
          ariaLabel="Agent activity"
          columns={COLUMNS}
          rows={rows}
          rowId={(row) => row.id}
          loading={loading}
          error={error}
          emptyState={emptyState}
          pagination={{
            page,
            pageSize,
            total,
            onPaginationChange,
            pageSizeOptions: AGENT_ACTIVITY_PAGE_SIZES,
          }}
          disableExport
          renderer={renderer}
          tabletBreakpoint={840}
          slots={SLOTS}
        />
      </LayoutReport.Provider>
    </Box>
  );
}
