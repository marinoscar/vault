import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Alert, Box, Button, FormControlLabel, Paper, Snackbar, Switch, TextField, Typography } from '@mui/material';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';
import { useSystemSettings } from '../../../core/headless/useSystemSettings.js';
import { LoadingSpinner } from '../../../core/ui/LoadingSpinner.js';
import { SettingsPageFrame } from '../../../core/ui/SettingsPageFrame.js';
import { AGENT_ACCESS_DEFAULTS, type AgentAccessSettings } from '../../../core/headless/types.js';

type LimitKey = Exclude<keyof AgentAccessSettings, 'enabled'>;

const LIMITS: { key: LimitKey; label: string; help: string }[] = [
  { key: 'lookupPerMinute', label: 'Lookups per minute', help: 'Finding a login for a website.' },
  { key: 'fillPerMinute', label: 'Fills per minute', help: 'Handing a login to an agent.' },
  { key: 'totpPerMinute', label: 'One-time codes per minute', help: 'Reading a one-time code.' },
  { key: 'writePerMinute', label: 'Writes per minute', help: 'Creating or rotating a login.' },
];

const MIN = 1;
const MAX = 600;

const validLimit = (text: string) => /^\d+$/.test(text) && Number(text) >= MIN && Number(text) <= MAX;

/**
 * The `Agent access` card of the Console (`/admin/settings/agent-access`, E14.7): the deployment
 * kill switch and the per-minute limits of the agent credential API (`agentAccess` system
 * settings). Read needs `system_settings:read` (the route gates on it); every control is disabled
 * without `system_settings:write`.
 */
export default function AgentAccessSettingsPage() {
  const { hasPermission } = usePermissions();
  const { settings, isLoading, error, isSaving, updateSettings } = useSystemSettings();
  const current: AgentAccessSettings = settings?.agentAccess ?? AGENT_ACCESS_DEFAULTS;

  const [enabled, setEnabled] = useState(current.enabled);
  const [limits, setLimits] = useState<Record<LimitKey, string>>(() => toText(current));
  const [success, setSuccess] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(current.enabled);
    setLimits(toText(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.version]);

  if (!hasPermission('system_settings:read')) return <Navigate to="/" replace />;
  const canWrite = hasPermission('system_settings:write');
  if (isLoading) return <LoadingSpinner />;

  const allValid = LIMITS.every(({ key }) => validLimit(limits[key]));
  const dirty =
    enabled !== current.enabled || LIMITS.some(({ key }) => Number(limits[key]) !== current[key]);

  const save = async () => {
    try {
      const next: AgentAccessSettings = {
        enabled,
        lookupPerMinute: Number(limits.lookupPerMinute),
        fillPerMinute: Number(limits.fillPerMinute),
        totpPerMinute: Number(limits.totpPerMinute),
        writePerMinute: Number(limits.writePerMinute),
      };
      await updateSettings({ agentAccess: next });
      setSuccess('Settings saved');
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  return (
    <SettingsPageFrame
      title="Agent access"
      description={`The kill switch and rate limits for apps that use logins on a person's behalf${canWrite ? '' : ' (read-only)'}`}
    >
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <FormControlLabel
          control={
            <Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={!canWrite || isSaving} />
          }
          label="Allow agents to use opened logins"
        />
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, mb: 3 }}>
          When off, every agent request is refused for everyone, whatever each person has allowed on a login. Agents can
          only use logins their owner opened to agents on the secret's page.
        </Typography>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
          {LIMITS.map(({ key, label, help }) => (
            <TextField
              key={key}
              label={label}
              value={limits[key]}
              onChange={(e) => setLimits((l) => ({ ...l, [key]: e.target.value }))}
              disabled={!canWrite || isSaving}
              error={!validLimit(limits[key])}
              helperText={validLimit(limits[key]) ? help : `Enter a whole number from ${MIN} to ${MAX}.`}
              slotProps={{ htmlInput: { inputMode: 'numeric', min: MIN, max: MAX } }}
              type="number"
            />
          ))}
        </Box>
        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 1 }}>
          Each limit counts per app and person.
        </Typography>
        {canWrite && (
          <Button variant="contained" sx={{ mt: 3 }} onClick={save} disabled={!dirty || !allValid || isSaving}>
            Save
          </Button>
        )}
      </Paper>
      <Snackbar open={!!success} autoHideDuration={3000} onClose={() => setSuccess(null)} message={success} />
      <Snackbar open={!!failure} autoHideDuration={5000} onClose={() => setFailure(null)}>
        <Alert severity="error" onClose={() => setFailure(null)}>
          {failure}
        </Alert>
      </Snackbar>
    </SettingsPageFrame>
  );
}

function toText(s: AgentAccessSettings): Record<LimitKey, string> {
  return {
    lookupPerMinute: String(s.lookupPerMinute),
    fillPerMinute: String(s.fillPerMinute),
    totpPerMinute: String(s.totpPerMinute),
    writePerMinute: String(s.writePerMinute),
  };
}
