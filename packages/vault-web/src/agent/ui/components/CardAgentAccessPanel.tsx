import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import { AddOutlined as AddIcon } from '@mui/icons-material';

import {
  cardGrantErrorMessage,
  describeGrantLimits,
  formatGrantAmount,
  type CardGrant,
  type CardGrantRequest,
} from '../../headless/cardGrants.js';
import { useCardGrants } from '../../headless/useCardGrants.js';
import { CardGrantDialog } from './CardGrantDialog.js';

export interface CardAgentAccessPanelProps {
  secretId: string;
  cardName: string;
  /** `fill` when the card is opened to agents. */
  agentAccess: 'none' | 'fill';
  /** The viewer holds `secrets:write`. Writes also need a browser session, which the web app always is. */
  canWrite: boolean;
  /** Opens or closes the card to agents (the page's `setAgentAccess`). */
  onToggle: (enabled: boolean) => Promise<void> | void;
  toggling?: boolean;
}

const STATUS_COLOR = { active: 'success', expired: 'default', revoked: 'default' } as const;
const STATUS_LABEL = { active: 'Active', expired: 'Expired', revoked: 'Revoked' } as const;

function GrantRow({ grant, canWrite, busy, onRevoke }: { grant: CardGrant; canWrite: boolean; busy: boolean; onRevoke: () => void }) {
  const per = grant.periodLimit?.period ?? 'day';
  return (
    <Box sx={{ py: 1.5, display: 'flex', flexDirection: 'column', gap: 0.75, minWidth: 0 }} data-testid="card-grant">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere', minWidth: 0 }}>
          {grant.merchantOrigin}
        </Typography>
        <Chip size="small" variant="outlined" color={STATUS_COLOR[grant.status]} label={STATUS_LABEL[grant.status]} />
        {grant.includeSecurityCode && <Chip size="small" variant="outlined" label="Security code" />}
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {describeGrantLimits(grant)}
        {grant.expiresAt ? ` · until ${new Date(grant.expiresAt).toLocaleDateString()}` : ''}
      </Typography>
      {grant.frameOrigins.length > 0 && (
        <Typography variant="caption" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
          Payment frames: {grant.frameOrigins.join(', ')}
        </Typography>
      )}
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {grant.usage.totalReleases === 0
          ? 'Not used yet'
          : `Used ${grant.usage.periodReleases} ${grant.usage.periodReleases === 1 ? 'time' : 'times'} this ${per} (${formatGrantAmount(
              grant.usage.periodAmount,
              grant.currency,
            )}), ${grant.usage.totalReleases} in all`}
      </Typography>
      {grant.status === 'active' && canWrite && (
        <Box>
          <Button size="small" color="error" onClick={onRevoke} disabled={busy} aria-label={`Revoke ${grant.merchantOrigin}`}>
            Revoke
          </Button>
        </Box>
      )}
    </Box>
  );
}

function RequestRow({
  request,
  canWrite,
  busy,
  onApprove,
  onDecline,
}: {
  request: CardGrantRequest;
  canWrite: boolean;
  busy: boolean;
  onApprove: () => void;
  onDecline: () => void;
}) {
  return (
    <Box sx={{ py: 1.5, display: 'flex', flexDirection: 'column', gap: 0.75, minWidth: 0 }} data-testid="card-grant-request">
      <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
        <Box component="span" sx={{ fontWeight: 600 }}>
          {request.clientName ?? 'An app'}
        </Box>{' '}
        asks to use this card at <Box component="span" sx={{ fontWeight: 600 }}>{request.origin}</Box> for up to{' '}
        {formatGrantAmount(request.amount, request.currency)}.
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
        “{request.reason}” · {new Date(request.createdAt).toLocaleString()}
      </Typography>
      {canWrite && (
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="contained" onClick={onApprove} disabled={busy} aria-label={`Approve ${request.origin}`}>
            Approve
          </Button>
          <Button size="small" onClick={onDecline} disabled={busy} aria-label={`Decline ${request.origin}`}>
            Decline
          </Button>
        </Stack>
      )}
    </Box>
  );
}

/**
 * "Agent access" on a card (ADR-0003): open or closed, the pending requests agents made with
 * Approve and Decline, the merchant grants with their limits and use, and the form to allow a shop.
 * Never shows a card number: grants and requests carry none.
 */
export function CardAgentAccessPanel({ secretId, cardName, agentAccess, canWrite, onToggle, toggling = false }: CardAgentAccessPanelProps) {
  const { grants, requests, loading, error, create, revoke, approve, decline } = useCardGrants(secretId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setFailure(null);
    try {
      await work();
    } catch (err) {
      setFailure(cardGrantErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const opened = agentAccess === 'fill';

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, px: 2, py: 1.5, mt: 2, minWidth: 0 }} aria-label="Agent access">
      <FormControlLabel
        sx={{ alignItems: 'flex-start', m: 0, gap: 1, minWidth: 0 }}
        control={
          <Switch
            checked={opened}
            onChange={(e) => void onToggle(e.target.checked)}
            disabled={!canWrite || toggling}
            slotProps={{ input: { 'aria-describedby': 'card-agent-access-help' } }}
          />
        }
        label={
          <Typography variant="body2" sx={{ fontWeight: 600, pt: 0.75 }}>
            Allow agents to use this card
          </Typography>
        }
      />
      <Typography id="card-agent-access-help" variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
        Agents you connect can type this card only at the shops you allow below, one field at a time and up to the
        amount you set. They never see it in chat. Prefer a virtual card with its own limit.
      </Typography>

      {failure && (
        <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setFailure(null)}>
          {failure}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mt: 1.5 }}>
          {error}
        </Alert>
      )}

      {requests.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" component="h3">
            Requests ({requests.length})
          </Typography>
          {requests.map((request, index) => (
            <Box key={request.id}>
              {index > 0 && <Divider />}
              <RequestRow
                request={request}
                canWrite={canWrite}
                busy={busy}
                onApprove={() => void run(() => approve(request.id))}
                onDecline={() => void run(() => decline(request.id))}
              />
            </Box>
          ))}
        </Box>
      )}

      <Box sx={{ mt: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="subtitle2" component="h3">
            Allowed shops
          </Typography>
          {canWrite && (
            <Button size="small" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
              Allow a shop
            </Button>
          )}
        </Box>
        {!loading && grants.length === 0 && (
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
            No shop yet. {opened ? 'Agents cannot use this card until you allow one.' : ''}
          </Typography>
        )}
        {grants.map((grant, index) => (
          <Box key={grant.id}>
            {index > 0 && <Divider />}
            <GrantRow grant={grant} canWrite={canWrite} busy={busy} onRevoke={() => void run(() => revoke(grant.id))} />
          </Box>
        ))}
      </Box>

      <CardGrantDialog
        open={dialogOpen}
        cardName={cardName}
        onClose={() => setDialogOpen(false)}
        onSubmit={create}
        errorMessage={cardGrantErrorMessage}
      />
    </Paper>
  );
}
