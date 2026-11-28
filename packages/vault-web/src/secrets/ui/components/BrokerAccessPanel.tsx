import { useState } from 'react';
import { Box, Button, FormControlLabel, IconButton, Paper, Switch, Tooltip, Typography } from '@mui/material';
import { ContentCopy as CopyIcon, Check as CheckIcon } from '@mui/icons-material';
import { useCopyToClipboard } from '../../../core/headless/useCopyToClipboard.js';
import type { SecretDetail } from '../../../core/headless/types.js';
import { brokerSensitiveFields, brokerUrls, describeBrokerInjection } from '../../headless/brokerAccess.js';

function UrlRow({ origin, url }: { origin: string; url: string }) {
  const { copy, copied } = useCopyToClipboard();
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>
          {origin}
        </Typography>
        <Typography variant="body2" component="code" sx={{ overflowWrap: 'anywhere', fontFamily: 'monospace' }}>
          {url}
        </Typography>
      </Box>
      <Tooltip title={copied ? 'Copied' : 'Copy base URL'}>
        <IconButton size="small" aria-label={`Copy base URL for ${origin}`} onClick={() => void copy(url)}>
          {copied ? <CheckIcon fontSize="small" /> : <CopyIcon fontSize="small" />}
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export interface BrokerAccessPanelProps {
  secret: SecretDetail;
  canWrite: boolean;
  saving: boolean;
  /** Turning on opens the dialog; turning off applies at once. */
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
}

/** The "Allow use through the broker" block of the secret page (#246). */
export function BrokerAccessPanel({ secret, canWrite, saving, onToggle, onEdit }: BrokerAccessPanelProps) {
  const on = secret.brokerAccess === true;
  const origins = secret.brokerOrigins ?? [];
  const [windowOrigin] = useState(() => window.location.origin);
  const field = secret.brokerField ?? brokerSensitiveFields(secret.type)[0];
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, px: 2, py: 1.5, mt: 2 }}>
      <FormControlLabel
        sx={{ alignItems: 'flex-start', m: 0, gap: 1, minWidth: 0 }}
        control={
          <Switch
            checked={on}
            onChange={(e) => onToggle(e.target.checked)}
            disabled={!canWrite || saving}
            slotProps={{ input: { 'aria-describedby': 'broker-access-help' } }}
          />
        }
        label={
          <Typography variant="body2" sx={{ fontWeight: 600, pt: 0.75 }}>
            Allow use through the broker
          </Typography>
        }
      />
      <Typography id="broker-access-help" variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
        An agent can call a service with this key without ever seeing it: Vault adds the key to the request and
        forwards it only to the origins you allow. Every use is recorded in Agent activity.
      </Typography>
      {on && (
        <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box>
            <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>
              Injection
            </Typography>
            <Typography variant="body2">
              {describeBrokerInjection(secret.brokerInjection)}
              {field ? ` (field ${field})` : ''}
            </Typography>
          </Box>
          {canWrite && (
            <Box>
              <Button size="small" onClick={onEdit} disabled={saving} aria-label="Edit broker access">
                Edit
              </Button>
            </Box>
          )}
          <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>
            Base URLs for your SDK
          </Typography>
          {brokerUrls(secret.id, origins, windowOrigin).map((u) => (
            <UrlRow key={u.origin} {...u} />
          ))}
        </Box>
      )}
    </Paper>
  );
}
