import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, MenuItem, TextField } from '@mui/material';
import { AppsOutlined as AppsIcon } from '@mui/icons-material';
import { SettingsPageFrame } from '../../../core/ui/SettingsPageFrame.js';
import {
  AGENT_ACTION_LABELS,
  AGENT_ACTIVITY_ACTIONS,
  type AgentActivityAction,
  type AgentActivityQuery,
} from '../../headless/agentActivity.js';
import { useAgentActivity } from '../../headless/useAgentActivity.js';
import { AgentActivityTable, AGENT_ACTIVITY_PAGE_SIZES } from '../components/AgentActivityTable.js';

/** A `YYYY-MM-DD` input value as the start (or end) of that local day, ISO. */
function dayBound(value: string, end: boolean): string | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}${end ? 'T23:59:59.999' : 'T00:00:00'}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

const FIELD_SX = { flex: '1 1 160px', minWidth: 0, '& .MuiInputBase-root': { minHeight: 44 } };

/**
 * The `Agent activity` card (`/settings/agent-activity`, E14.7): what apps did with the caller's
 * logins, with filters and a link to Connected apps to revoke one. Read needs `secrets:read`
 * (the route gates on it).
 */
export default function AgentActivityPage() {
  const [action, setAction] = useState<AgentActivityAction | ''>('');
  const [clientId, setClientId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(AGENT_ACTIVITY_PAGE_SIZES[1]);
  // Apps seen so far, so the filter keeps offering one after it narrows the list to itself.
  const [apps, setApps] = useState<Map<string, string>>(new Map());

  const query = useMemo<AgentActivityQuery>(
    () => ({
      page: page + 1,
      pageSize,
      action: action || undefined,
      clientId: clientId || undefined,
      from: dayBound(from, false),
      to: dayBound(to, true),
    }),
    [page, pageSize, action, clientId, from, to],
  );
  const { items, total, loading, error } = useAgentActivity(query);

  useEffect(() => {
    const additions = items.filter((i) => i.clientId && !apps.has(i.clientId));
    if (additions.length === 0) return;
    setApps((prev) => {
      const next = new Map(prev);
      for (const i of additions) next.set(i.clientId as string, i.clientName ?? 'Unknown app');
      return next;
    });
  }, [items, apps]);

  const filtered = Boolean(action || clientId || from || to);
  const reset = (fn: () => void) => {
    fn();
    setPage(0);
  };

  return (
    <SettingsPageFrame
      title="Agent activity"
      description="Which apps used or changed your logins, on which website and why. Never a password or code."
      maxWidth="lg"
    >
      <Box sx={{ mb: 2 }}>
        <Button component={RouterLink} to="/settings/connected-apps" variant="outlined" startIcon={<AppsIcon />}>
          Manage connected apps
        </Button>
      </Box>
      <Box role="search" aria-label="Filter agent activity" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 2, minWidth: 0 }}>
        <TextField
          select
          size="small"
          label="Action"
          value={action}
          onChange={(e) => reset(() => setAction(e.target.value as AgentActivityAction | ''))}
          sx={FIELD_SX}
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
        >
          <MenuItem value="">All actions</MenuItem>
          {AGENT_ACTIVITY_ACTIONS.map((a) => (
            <MenuItem key={a} value={a}>
              {AGENT_ACTION_LABELS[a]}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="App"
          value={clientId}
          onChange={(e) => reset(() => setClientId(e.target.value))}
          sx={FIELD_SX}
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
        >
          <MenuItem value="">All apps</MenuItem>
          {[...apps.entries()].map(([id, name]) => (
            <MenuItem key={id} value={id}>
              {name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          type="date"
          label="From"
          value={from}
          onChange={(e) => reset(() => setFrom(e.target.value))}
          sx={FIELD_SX}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          size="small"
          type="date"
          label="To"
          value={to}
          onChange={(e) => reset(() => setTo(e.target.value))}
          sx={FIELD_SX}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      </Box>
      <AgentActivityTable
        rows={items}
        total={total}
        page={page}
        pageSize={pageSize}
        loading={loading}
        error={error}
        filtered={filtered}
        onPaginationChange={(next) => {
          setPage(next.page);
          setPageSize(next.pageSize);
        }}
      />
    </SettingsPageFrame>
  );
}
