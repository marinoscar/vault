import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Alert, Box, Button, Divider, FormControlLabel, Paper, Snackbar, Switch, TextField, Typography } from '@mui/material';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';
import { useSystemSettings } from '../../../core/headless/useSystemSettings.js';
import { LoadingSpinner } from '../../../core/ui/LoadingSpinner.js';
import { SettingsPageFrame } from '../../../core/ui/SettingsPageFrame.js';
import { AGENT_ACCESS_DEFAULTS, type AgentAccessSettings, type AgentBrokerAccessSettings } from '../../../core/headless/types.js';

type LimitKey =
  | 'lookupPerMinute'
  | 'fillPerMinute'
  | 'totpPerMinute'
  | 'writePerMinute'
  | 'revealPerMinute'
  | 'cardFillPerMinute'
  | 'cardReleasesPerDay'
  | 'identityFillPerMinute';

interface LimitDef {
  key: LimitKey;
  label: string;
  help: string;
  max: number;
}

const LOGIN_LIMITS: LimitDef[] = [
  { key: 'lookupPerMinute', label: 'Lookups per minute', help: 'Finding a login, card or identity for a website.', max: 600 },
  { key: 'fillPerMinute', label: 'Fills per minute', help: 'Handing a login to an agent.', max: 600 },
  { key: 'totpPerMinute', label: 'One-time codes per minute', help: 'Reading a one-time code.', max: 600 },
  { key: 'writePerMinute', label: 'Writes per minute', help: 'Creating or rotating a login, or asking for a shop.', max: 600 },
  { key: 'revealPerMinute', label: 'Reveals per minute', help: "Reading a secret's value through reveal_secret.", max: 10000 },
];
const CARD_LIMITS: LimitDef[] = [
  { key: 'cardFillPerMinute', label: 'Card fills per minute', help: 'Handing one card field to an agent.', max: 600 },
  { key: 'cardReleasesPerDay', label: 'Card uses per card per day', help: 'Card numbers handed out, per card, per day.', max: 1000 },
];
const IDENTITY_LIMITS: LimitDef[] = [
  { key: 'identityFillPerMinute', label: 'Identity fills per minute', help: 'Handing one identity field to an agent.', max: 600 },
];
const ALL_LIMITS = [...LOGIN_LIMITS, ...CARD_LIMITS, ...IDENTITY_LIMITS];

const MIN = 1;
const MIB = 1024 * 1024;

/** The broker block's text fields: sizes in MB and the timeout in seconds on screen, bytes and ms on the wire. */
type BrokerKey = 'forwardsPerMinute' | 'maxRequestMb' | 'maxResponseMb' | 'timeoutSeconds';
const BROKER_FIELDS: Array<{ key: BrokerKey; label: string; help: string; min: number; max: number }> = [
  { key: 'forwardsPerMinute', label: 'Forwards per minute', help: 'Calls forwarded through the broker, per token.', min: 1, max: 10000 },
  { key: 'maxRequestMb', label: 'Largest request (MB)', help: 'A bigger request body is refused.', min: 1, max: 100 },
  { key: 'maxResponseMb', label: 'Largest response (MB)', help: 'A bigger upstream response is withheld.', min: 1, max: 100 },
  { key: 'timeoutSeconds', label: 'Timeout (seconds)', help: 'How long Vault waits for the service.', min: 1, max: 120 },
];
const validBroker = (text: string, min: number, max: number) => /^\d+(\.\d+)?$/.test(text) && Number(text) >= min && Number(text) <= max;

function brokerOf(s: AgentAccessSettings): AgentBrokerAccessSettings {
  return { ...AGENT_ACCESS_DEFAULTS.broker!, ...(s.broker ?? {}) };
}

function brokerToText(b: AgentBrokerAccessSettings): Record<BrokerKey, string> {
  return {
    forwardsPerMinute: String(b.forwardsPerMinute),
    maxRequestMb: String(Math.round((b.maxRequestBytes / MIB) * 100) / 100),
    maxResponseMb: String(Math.round((b.maxResponseBytes / MIB) * 100) / 100),
    timeoutSeconds: String(Math.round((b.timeoutMs / 1000) * 100) / 100),
  };
}

const validLimit = (text: string, max: number) => /^\d+$/.test(text) && Number(text) >= MIN && Number(text) <= max;

/** The stored namespace with the ADR-0003 blocks filled in (an older API has neither). */
function resolve(s: AgentAccessSettings): Required<AgentAccessSettings> {
  return {
    ...AGENT_ACCESS_DEFAULTS,
    ...s,
    cards: { ...AGENT_ACCESS_DEFAULTS.cards!, ...(s.cards ?? {}) },
    identity: { ...AGENT_ACCESS_DEFAULTS.identity!, ...(s.identity ?? {}) },
    broker: brokerOf(s),
  } as Required<AgentAccessSettings>;
}

function toText(s: Required<AgentAccessSettings>): Record<LimitKey, string> {
  return {
    lookupPerMinute: String(s.lookupPerMinute),
    fillPerMinute: String(s.fillPerMinute),
    totpPerMinute: String(s.totpPerMinute),
    writePerMinute: String(s.writePerMinute),
    revealPerMinute: String(s.revealPerMinute),
    cardFillPerMinute: String(s.cards.fillPerMinute),
    cardReleasesPerDay: String(s.cards.releasesPerCardPerDay),
    identityFillPerMinute: String(s.identity.fillPerMinute),
  };
}

/**
 * The `Agent access` card of the Console (`/admin/settings/agent-access`, E14.7, ADR-0003): the
 * deployment kill switch, the card and identity switches (both off by default) and the limits of
 * the agent credential API (`agentAccess` system settings). Read needs `system_settings:read` (the
 * route gates on it); every control is disabled without `system_settings:write`.
 */
export default function AgentAccessSettingsPage() {
  const { hasPermission } = usePermissions();
  const { settings, isLoading, error, isSaving, updateSettings } = useSystemSettings();
  const current = resolve(settings?.agentAccess ?? AGENT_ACCESS_DEFAULTS);

  const [enabled, setEnabled] = useState(current.enabled);
  const [cardsEnabled, setCardsEnabled] = useState(current.cards.enabled);
  const [identityEnabled, setIdentityEnabled] = useState(current.identity.enabled);
  const [brokerEnabled, setBrokerEnabled] = useState(current.broker.enabled);
  const [broker, setBroker] = useState<Record<BrokerKey, string>>(() => brokerToText(current.broker));
  const [limits, setLimits] = useState<Record<LimitKey, string>>(() => toText(current));
  const [success, setSuccess] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(current.enabled);
    setCardsEnabled(current.cards.enabled);
    setIdentityEnabled(current.identity.enabled);
    setLimits(toText(current));
    setBrokerEnabled(current.broker.enabled);
    setBroker(brokerToText(current.broker));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.version]);

  if (!hasPermission('system_settings:read')) return <Navigate to="/" replace />;
  const canWrite = hasPermission('system_settings:write');
  if (isLoading) return <LoadingSpinner />;

  const brokerValid = BROKER_FIELDS.every(({ key, min, max }) => validBroker(broker[key], min, max));
  const allValid = brokerValid && ALL_LIMITS.every(({ key, max }) => validLimit(limits[key], max));
  const saved = toText(current);
  const dirty =
    enabled !== current.enabled ||
    cardsEnabled !== current.cards.enabled ||
    identityEnabled !== current.identity.enabled ||
    brokerEnabled !== current.broker.enabled ||
    BROKER_FIELDS.some(({ key }) => Number(broker[key]) !== Number(brokerToText(current.broker)[key])) ||
    ALL_LIMITS.some(({ key }) => Number(limits[key]) !== Number(saved[key]));

  const save = async () => {
    try {
      const next: AgentAccessSettings = {
        enabled,
        lookupPerMinute: Number(limits.lookupPerMinute),
        fillPerMinute: Number(limits.fillPerMinute),
        totpPerMinute: Number(limits.totpPerMinute),
        writePerMinute: Number(limits.writePerMinute),
        revealPerMinute: Number(limits.revealPerMinute),
        cards: {
          enabled: cardsEnabled,
          fillPerMinute: Number(limits.cardFillPerMinute),
          releasesPerCardPerDay: Number(limits.cardReleasesPerDay),
        },
        identity: { enabled: identityEnabled, fillPerMinute: Number(limits.identityFillPerMinute) },
        broker: {
          enabled: brokerEnabled,
          forwardsPerMinute: Number(broker.forwardsPerMinute),
          maxRequestBytes: Math.round(Number(broker.maxRequestMb) * MIB),
          maxResponseBytes: Math.round(Number(broker.maxResponseMb) * MIB),
          timeoutMs: Math.round(Number(broker.timeoutSeconds) * 1000),
        },
      };
      await updateSettings({ agentAccess: next });
      setSuccess('Settings saved');
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  const limitFields = (defs: LimitDef[]) => (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
      {defs.map(({ key, label, help, max }) => (
        <TextField
          key={key}
          label={label}
          value={limits[key]}
          onChange={(e) => setLimits((l) => ({ ...l, [key]: e.target.value }))}
          disabled={!canWrite || isSaving}
          error={!validLimit(limits[key], max)}
          helperText={validLimit(limits[key], max) ? help : `Enter a whole number from ${MIN} to ${max}.`}
          slotProps={{ htmlInput: { inputMode: 'numeric', min: MIN, max } }}
          type="number"
        />
      ))}
    </Box>
  );

  const toggle = (checked: boolean, onChange: (v: boolean) => void, label: string, help: string) => (
    <>
      <FormControlLabel
        control={<Switch checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={!canWrite || isSaving} />}
        label={label}
      />
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, mb: 2 }}>
        {help}
      </Typography>
    </>
  );

  return (
    <SettingsPageFrame
      title="Agent access"
      description={`The kill switches and rate limits for apps that use logins, cards and identity details on a person's behalf${canWrite ? '' : ' (read-only)'}`}
    >
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        {toggle(
          enabled,
          setEnabled,
          'Allow agents to use opened logins',
          "When off, every agent request is refused for everyone, whatever each person has allowed on a login, a card or an identity item. Agents can only use what their owner opened to agents on the secret's page.",
        )}
        {limitFields(LOGIN_LIMITS)}
        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 1 }}>
          Each limit counts per app and person.
        </Typography>

        <Divider sx={{ my: 3 }} />
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, mb: 1 }}>
          Cards
        </Typography>
        {toggle(
          cardsEnabled,
          setCardsEnabled,
          'Allow agents to use cards',
          'Off by default. When on, an agent can use a card only at a shop its owner allowed, up to the amount they set, one field at a time.',
        )}
        {limitFields(CARD_LIMITS)}

        <Divider sx={{ my: 3 }} />
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, mb: 1 }}>
          Identity
        </Typography>
        {toggle(
          identityEnabled,
          setIdentityEnabled,
          'Allow agents to fill identity details',
          'Off by default. When on, an agent can fill the identity details a person opened; the date of birth and id number only on websites they allowed.',
        )}
        {limitFields(IDENTITY_LIMITS)}

        <Divider sx={{ my: 3 }} />
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, mb: 1 }}>
          Credential broker
        </Typography>
        {toggle(
          brokerEnabled,
          setBrokerEnabled,
          'Allow the credential broker',
          'Off by default. When on, an agent can call a service with a key an owner allowed on the secret page, without ever seeing the key: Vault adds it and forwards only to the origins the owner listed. Needs the switch at the top too.',
        )}
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
          {BROKER_FIELDS.map(({ key, label, help, min, max }) => (
            <TextField
              key={key}
              label={label}
              value={broker[key]}
              onChange={(e) => setBroker((b) => ({ ...b, [key]: e.target.value }))}
              disabled={!canWrite || isSaving}
              error={!validBroker(broker[key], min, max)}
              helperText={validBroker(broker[key], min, max) ? help : `Enter a number from ${min} to ${max}.`}
              slotProps={{ htmlInput: { inputMode: 'decimal', min, max } }}
              type="number"
            />
          ))}
        </Box>

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
