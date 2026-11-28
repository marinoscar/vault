import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Add as AddIcon, ContentCopy as CopyIcon, Check as CheckIcon } from '@mui/icons-material';
import { BROKER_TOKEN_MAX_EXPIRES_DAYS } from '@marinoscar/vault-contract/broker';
import { SettingsPageFrame } from '../../../core/ui/SettingsPageFrame.js';
import { LoadingSpinner } from '../../../core/ui/LoadingSpinner.js';
import { useCopyToClipboard } from '../../../core/headless/useCopyToClipboard.js';
import { getSecrets } from '../../../core/headless/api.js';
import type { SecretListItem } from '../../../core/headless/types.js';
import {
  brokerTokenErrorMessage,
  brokerTokenStatus,
  createBrokerToken,
  revokeBrokerToken,
  useBrokerTokens,
  type BrokerToken,
} from '../../headless/brokerTokens.js';

const EXPIRY_CHOICES = ['30', '90', '365', 'custom'] as const;

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : 'Never';
}

/** The token, shown once, with a copy button. Closing the dialog drops it from memory. */
function TokenShownOnce({ token, onClose }: { token: string; onClose: () => void }) {
  const { copy, copied } = useCopyToClipboard();
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="broker-token-once-title">
      <DialogTitle id="broker-token-once-title">Copy your broker token</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          This is the only time the token is shown. Copy it now: Vault cannot show it again.
        </Alert>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TextField
            value={token}
            fullWidth
            size="small"
            slotProps={{ htmlInput: { readOnly: true, 'aria-label': 'Broker token', style: { fontFamily: 'monospace' } } }}
          />
          <Tooltip title={copied ? 'Copied' : 'Copy token'}>
            <IconButton aria-label="Copy token" onClick={() => void copy(token)}>
              {copied ? <CheckIcon /> : <CopyIcon />}
            </IconButton>
          </Tooltip>
        </Box>
        <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>
          Save it as a network secret for your Vault host in Claude Code (cloud), then point your SDK at the
          broker URL shown on the secret's page.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CreateTokenDialog({
  secrets,
  saving,
  error,
  onCancel,
  onCreate,
}: {
  secrets: SecretListItem[];
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onCreate: (body: { name: string; expiresInDays: number; secretIds?: string[] }) => void;
}) {
  const [name, setName] = useState('');
  const [choice, setChoice] = useState<(typeof EXPIRY_CHOICES)[number]>('90');
  const [custom, setCustom] = useState('90');
  const [selected, setSelected] = useState<SecretListItem[]>([]);
  const days = choice === 'custom' ? Number(custom) : Number(choice);
  const daysValid = Number.isInteger(days) && days >= 1 && days <= BROKER_TOKEN_MAX_EXPIRES_DAYS;
  const nameValid = name.trim().length > 0 && name.trim().length <= 100;

  return (
    <Dialog open onClose={() => !saving && onCancel()} maxWidth="sm" fullWidth aria-labelledby="broker-token-create-title">
      <DialogTitle id="broker-token-create-title">Create a broker token</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            helperText="Where the token is used, for example Cloud agent"
            size="small"
            autoFocus
            required
          />
          <FormControl size="small">
            <InputLabel id="broker-expiry-label">Expires after</InputLabel>
            <Select labelId="broker-expiry-label" label="Expires after" value={choice} onChange={(e) => setChoice(e.target.value as typeof choice)}>
              <MenuItem value="30">30 days</MenuItem>
              <MenuItem value="90">90 days</MenuItem>
              <MenuItem value="365">365 days</MenuItem>
              <MenuItem value="custom">Custom</MenuItem>
            </Select>
          </FormControl>
          {choice === 'custom' && (
            <TextField
              label="Days"
              type="number"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              error={!daysValid}
              helperText={daysValid ? ' ' : `Enter a whole number from 1 to ${BROKER_TOKEN_MAX_EXPIRES_DAYS}.`}
              size="small"
              slotProps={{ htmlInput: { min: 1, max: BROKER_TOKEN_MAX_EXPIRES_DAYS } }}
            />
          )}
          <Autocomplete
            multiple
            size="small"
            options={secrets}
            value={selected}
            onChange={(_e, next) => setSelected(next)}
            getOptionLabel={(s) => s.name}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            noOptionsText="No secrets are allowed through the broker yet"
            renderInput={(params) => (
              <TextField {...params} label="Restrict to secrets" helperText="Leave empty for every secret you allowed through the broker" />
            )}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={saving || !nameValid || !daysValid}
          onClick={() =>
            onCreate({
              name: name.trim(),
              expiresInDays: days,
              ...(selected.length > 0 ? { secretIds: selected.map((s) => s.id) } : {}),
            })
          }
        >
          Create token
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * The `Broker tokens` card (`/settings/broker-tokens`, #246, ADR-0006). Bare `@Auth()` on the API
 * (the same as personal access tokens), so the card has no permission. The token is shown once.
 */
export default function BrokerTokensPage() {
  const { tokens, isLoading, error, refresh } = useBrokerTokens();
  const [secrets, setSecrets] = useState<SecretListItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<BrokerToken | null>(null);
  const [toast, setToast] = useState<{ severity: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openCreate = useCallback(async () => {
    setCreateError(null);
    setCreating(true);
    try {
      const res = await getSecrets({ brokerAccess: true, pageSize: 100 });
      setSecrets(res.items);
    } catch {
      setSecrets([]);
    }
  }, []);

  const create = async (body: { name: string; expiresInDays: number; secretIds?: string[] }) => {
    setSaving(true);
    setCreateError(null);
    try {
      const created = await createBrokerToken(body);
      setCreating(false);
      setShown(created.token);
      await refresh();
    } catch (err) {
      setCreateError(brokerTokenErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const revoke = async () => {
    if (!revoking) return;
    try {
      await revokeBrokerToken(revoking.id);
      setToast({ severity: 'success', message: 'Token revoked' });
      await refresh();
    } catch (err) {
      setToast({ severity: 'error', message: brokerTokenErrorMessage(err) });
    } finally {
      setRevoking(null);
    }
  };

  return (
    <SettingsPageFrame
      title="Broker tokens"
      description="Tokens that let an agent call a service through Vault without ever seeing the key. Save a token as a network secret for your Vault host in Claude Code (cloud), then point your SDK at the broker URL shown on the secret's page."
    >
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Box sx={{ mb: 2 }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => void openCreate()}>
          Create token
        </Button>
      </Box>
      {isLoading ? (
        <LoadingSpinner />
      ) : tokens.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            No broker tokens yet. Allow a secret through the broker on its page, then create a token here.
          </Typography>
        </Paper>
      ) : (
        <Box component="ul" aria-label="Broker tokens" sx={{ listStyle: 'none', p: 0, m: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {tokens.map((t) => {
            const status = brokerTokenStatus(t);
            return (
              <Paper component="li" key={t.id} variant="outlined" sx={{ p: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                <Box sx={{ flex: '1 1 220px', minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{t.name}</Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
                    {t.tokenPrefix}…
                  </Typography>
                  <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>
                    {t.secretIds.length === 0 ? 'All broker-enabled secrets' : `${t.secretIds.length} secret${t.secretIds.length === 1 ? '' : 's'}`}
                    {' · '}Expires {formatDate(t.expiresAt)}
                    {' · '}Last used {formatDate(t.lastUsedAt)}
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  variant="outlined"
                  color={status === 'active' ? 'success' : status === 'expired' ? 'warning' : 'default'}
                  label={status === 'active' ? 'Active' : status === 'expired' ? 'Expired' : 'Revoked'}
                />
                {status !== 'revoked' && (
                  <Button color="error" size="small" onClick={() => setRevoking(t)} aria-label={`Revoke ${t.name}`}>
                    Revoke
                  </Button>
                )}
              </Paper>
            );
          })}
        </Box>
      )}

      {creating && (
        <CreateTokenDialog secrets={secrets} saving={saving} error={createError} onCancel={() => setCreating(false)} onCreate={(b) => void create(b)} />
      )}
      {shown && <TokenShownOnce token={shown} onClose={() => setShown(null)} />}
      <Dialog open={!!revoking} onClose={() => setRevoking(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Revoke this token?</DialogTitle>
        <DialogContent>
          <Typography>
            {revoking?.name} stops working at once. Anything that uses it will be refused. This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevoking(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => void revoke()}>
            Revoke token
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={!!toast} autoHideDuration={4000} onClose={() => setToast(null)}>
        {toast ? (
          <Alert severity={toast.severity} onClose={() => setToast(null)}>
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </SettingsPageFrame>
  );
}
