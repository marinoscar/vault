import { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, FormControlLabel, Paper, Switch, TextField, Typography } from '@mui/material';

export interface IdentityAgentAccessPanelProps {
  /** `fill` when the item is opened to agents. */
  agentAccess: 'none' | 'fill';
  /** The origins its sensitive fields may be filled on (as stored: normalized). */
  agentOrigins: string[];
  /** The viewer holds `secrets:write`. */
  canWrite: boolean;
  /** Saves the access and, when given, the allowed origins. Throws on failure. */
  onSave: (agentAccess: 'none' | 'fill', allowedOrigins?: string[]) => Promise<void>;
  /** A friendly message for a failure. */
  errorMessage: (err: unknown) => string;
}

/** A website as typed (`form.example.test`, `https://form.example.test/apply`) to its origin, or null. */
export function toOrigin(text: string): string | null {
  const value = text.trim();
  if (!value || /\s/.test(value)) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    if (url.protocol !== 'https:' || !url.hostname) return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * "Agent access" on an Identity item (ADR-0003): open or closed, and the websites its sensitive
 * fields (date of birth, id number) may be filled on. Name, address and phone are filled on any
 * website once the item is opened.
 */
export function IdentityAgentAccessPanel({ agentAccess, agentOrigins, canWrite, onSave, errorMessage }: IdentityAgentAccessPanelProps) {
  const [origins, setOrigins] = useState<string[]>(agentOrigins);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const key = agentOrigins.join(' ');

  useEffect(() => {
    setOrigins(key ? key.split(' ') : []);
  }, [key]);

  const draftOrigin = toOrigin(draft);
  const dirty = origins.join(' ') !== key;

  const save = async (access: 'none' | 'fill', allowed?: string[]) => {
    setSaving(true);
    setFailure(null);
    try {
      await onSave(access, allowed);
    } catch (err) {
      setFailure(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const add = () => {
    if (!draftOrigin) return;
    if (!origins.includes(draftOrigin)) setOrigins([...origins, draftOrigin].sort());
    setDraft('');
  };

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, px: 2, py: 1.5, mt: 2, minWidth: 0 }} aria-label="Agent access">
      <FormControlLabel
        sx={{ alignItems: 'flex-start', m: 0, gap: 1, minWidth: 0 }}
        control={
          <Switch
            checked={agentAccess === 'fill'}
            onChange={(e) => void save(e.target.checked ? 'fill' : 'none')}
            disabled={!canWrite || saving}
            slotProps={{ input: { 'aria-describedby': 'identity-agent-access-help' } }}
          />
        }
        label={
          <Typography variant="body2" sx={{ fontWeight: 600, pt: 0.75 }}>
            Allow agents to fill these details
          </Typography>
        }
      />
      <Typography id="identity-agent-access-help" variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
        Agents you connect can type your name, address and phone into forms, one field at a time. Your date of birth
        and id number only on the websites below.
      </Typography>
      {failure && (
        <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setFailure(null)}>
          {failure}
        </Alert>
      )}
      <Typography variant="subtitle2" component="h3" sx={{ mt: 2 }}>
        Websites for date of birth and id number
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }} aria-label="Allowed websites">
        {origins.length === 0 && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            None: these two fields are never filled.
          </Typography>
        )}
        {origins.map((origin) => (
          <Chip
            key={origin}
            label={origin}
            size="small"
            sx={{ maxWidth: '100%' }}
            onDelete={canWrite ? () => setOrigins(origins.filter((o) => o !== origin)) : undefined}
          />
        ))}
      </Box>
      {canWrite && (
        <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: { xs: 'wrap', sm: 'nowrap' }, alignItems: 'flex-start' }}>
          <TextField
            size="small"
            label="Add a website"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            error={draft !== '' && !draftOrigin}
            helperText={draft !== '' && !draftOrigin ? 'Enter an https website, for example form.example.test.' : ' '}
            sx={{ flex: 1, minWidth: 0 }}
          />
          <Button onClick={add} disabled={!draftOrigin || saving}>
            Add
          </Button>
          <Button variant="contained" onClick={() => void save(agentAccess, origins)} disabled={!dirty || saving}>
            Save
          </Button>
        </Box>
      )}
    </Paper>
  );
}
