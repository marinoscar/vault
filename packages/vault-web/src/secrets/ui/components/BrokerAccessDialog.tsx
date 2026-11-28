import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { Add as AddIcon, Cancel as CancelIcon } from '@mui/icons-material';
import {
  BROKER_HEADER_PREFIXES,
  DEFAULT_BROKER_INJECTION,
  MAX_BROKER_ORIGINS,
  normalizeBrokerOriginText,
  validateBrokerOrigin,
  validateInjectionName,
  type BrokerInjection,
} from '../../headless/brokerAccess.js';

export interface BrokerAccessDialogProps {
  open: boolean;
  /** Names of the sensitive fields the key may come from; a picker shows when there are several. */
  fields: string[];
  initial: { origins: string[]; injection: BrokerInjection | null; field: string | null };
  saving: boolean;
  /** The last failure, shown inside the dialog. */
  error: string | null;
  onCancel: () => void;
  onSave: (body: { enabled: true; origins: string[]; injection: BrokerInjection; field?: string }) => void;
}

/**
 * "Allow use through the broker" (#246, ADR-0006): the allowed origins, how the key is added to a
 * request and, when the type has several sensitive fields, which one is the key. The API validates
 * again and stays the authority.
 */
export function BrokerAccessDialog({ open, fields, initial, saving, error, onCancel, onSave }: BrokerAccessDialogProps) {
  const start = initial.injection ?? DEFAULT_BROKER_INJECTION;
  const [origins, setOrigins] = useState<string[]>(initial.origins);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [kind, setKind] = useState<'header' | 'query'>(start.kind);
  const [name, setName] = useState(start.name);
  const [prefix, setPrefix] = useState<string>(start.kind === 'header' ? (start.prefix ?? '') : 'Bearer');
  const [field, setField] = useState(initial.field ?? (fields.length === 1 ? fields[0]! : ''));
  const [attempted, setAttempted] = useState(false);

  const addOrigin = () => {
    const problem = validateBrokerOrigin(draft);
    if (problem) {
      setDraftError(problem);
      return;
    }
    const origin = normalizeBrokerOriginText(draft);
    if (origins.includes(origin)) {
      setDraftError('This origin is already in the list');
      return;
    }
    if (origins.length >= MAX_BROKER_ORIGINS) {
      setDraftError(`At most ${MAX_BROKER_ORIGINS} origins`);
      return;
    }
    setOrigins([...origins, origin]);
    setDraft('');
    setDraftError(null);
  };

  const changeKind = (next: 'header' | 'query') => {
    setKind(next);
    setName(next === 'header' ? 'Authorization' : 'api_key');
  };

  const nameError = validateInjectionName(kind, name);
  const needsField = fields.length > 1;
  const fieldMissing = needsField && !fields.includes(field);
  const originsMissing = origins.length === 0;

  const submit = () => {
    setAttempted(true);
    if (originsMissing || nameError || fieldMissing) return;
    const injection: BrokerInjection =
      kind === 'header'
        ? { kind: 'header', name: name.trim(), ...(prefix ? { prefix: prefix as (typeof BROKER_HEADER_PREFIXES)[number] } : {}) }
        : { kind: 'query', name: name.trim() };
    onSave({ enabled: true, origins, injection, ...(needsField || field ? { field: field || fields[0] } : {}) });
  };

  return (
    <Dialog open={open} onClose={() => !saving && onCancel()} maxWidth="sm" fullWidth aria-labelledby="broker-dialog-title">
      <DialogTitle id="broker-dialog-title">Allow use through the broker</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          The key is never shown to the agent. Vault adds it to each request and forwards it only to the origins
          you list here. Every use is recorded in Agent activity.
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
          Allowed origins
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
          <TextField
            label="Origin"
            placeholder="https://api.service-x.example"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setDraftError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addOrigin();
              }
            }}
            error={!!draftError || (attempted && originsMissing)}
            helperText={draftError ?? (attempted && originsMissing ? 'Add at least one origin' : 'https://host or https://host:port, no path')}
            size="small"
            fullWidth
            disabled={saving}
          />
          <Button onClick={addOrigin} startIcon={<AddIcon />} disabled={saving || !draft.trim()} sx={{ mt: 0.25, whiteSpace: 'nowrap' }}>
            Add
          </Button>
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5, mb: 3 }} aria-label="Allowed origins">
          {origins.map((o) => (
            <Chip
              key={o}
              label={o}
              onDelete={saving ? undefined : () => setOrigins(origins.filter((x) => x !== o))}
              deleteIcon={<CancelIcon titleAccess={`Remove ${o}`} />}
              sx={{ maxWidth: '100%' }}
            />
          ))}
        </Box>

        <FormControl sx={{ mb: 2 }} disabled={saving}>
          <FormLabel id="broker-inject-label">How the key is added</FormLabel>
          <RadioGroup row aria-labelledby="broker-inject-label" value={kind} onChange={(e) => changeKind(e.target.value as 'header' | 'query')}>
            <FormControlLabel value="header" control={<Radio />} label="Header" />
            <FormControlLabel value="query" control={<Radio />} label="Query parameter" />
          </RadioGroup>
        </FormControl>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: kind === 'header' ? '2fr 1fr' : '1fr' } }}>
          <TextField
            label={kind === 'header' ? 'Header name' : 'Parameter name'}
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={!!nameError}
            helperText={nameError ?? ' '}
            size="small"
            disabled={saving}
          />
          {kind === 'header' && (
            <FormControl size="small" disabled={saving}>
              <InputLabel id="broker-prefix-label">Prefix</InputLabel>
              <Select labelId="broker-prefix-label" label="Prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)}>
                {BROKER_HEADER_PREFIXES.map((p) => (
                  <MenuItem key={p || 'none'} value={p}>
                    {p || 'None'}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </Box>

        {needsField && (
          <FormControl size="small" fullWidth sx={{ mt: 1 }} error={attempted && fieldMissing} disabled={saving}>
            <InputLabel id="broker-field-label">Field that holds the key</InputLabel>
            <Select labelId="broker-field-label" label="Field that holds the key" value={field} onChange={(e) => setField(e.target.value)}>
              {fields.map((f) => (
                <MenuItem key={f} value={f}>
                  {f}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={submit} disabled={saving}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

