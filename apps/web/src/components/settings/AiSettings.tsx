import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import KeyIcon from '@mui/icons-material/Key';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { useSystemSettings } from '../../hooks/useSystemSettings';
import {
  AI_API_KEY_MAX_LENGTH,
  AI_API_KEY_MIN_LENGTH,
  AI_MAX_CALLS_MAX,
  AI_MAX_CALLS_MIN,
  AI_SETTINGS_DEFAULTS,
} from '../../types';

interface AiSettingsProps {
  /** Set when the admin has read-only access to system settings. */
  disabled?: boolean;
}

function formatUpdatedAt(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString();
}

export function AiSettings({ disabled = false }: AiSettingsProps) {
  const { settings, isLoading, error, isSaving, updateAiSettings } =
    useSystemSettings();

  const ai = settings?.ai ?? null;
  const apiKeyConfigured = ai?.apiKeyConfigured ?? false;

  // Form state for the non-secret fields, seeded from the server and resynced
  // whenever the server copy changes (including after a save).
  const [enabled, setEnabled] = useState<boolean>(AI_SETTINGS_DEFAULTS.enabled);
  const [model, setModel] = useState<string>(AI_SETTINGS_DEFAULTS.model);
  const [maxCalls, setMaxCalls] = useState<string>(
    String(AI_SETTINGS_DEFAULTS.maxCallsPerUserPerDay),
  );

  // The plaintext credential lives only in this field, only until it is saved.
  const [newApiKey, setNewApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(ai?.enabled ?? AI_SETTINGS_DEFAULTS.enabled);
    setModel(ai?.model ?? AI_SETTINGS_DEFAULTS.model);
    setMaxCalls(
      String(
        ai?.maxCallsPerUserPerDay ??
          AI_SETTINGS_DEFAULTS.maxCallsPerUserPerDay,
      ),
    );
  }, [ai?.enabled, ai?.model, ai?.maxCallsPerUserPerDay]);

  const parsedMaxCalls = Number(maxCalls);
  const maxCallsValid =
    maxCalls.trim() !== '' &&
    Number.isInteger(parsedMaxCalls) &&
    parsedMaxCalls >= AI_MAX_CALLS_MIN &&
    parsedMaxCalls <= AI_MAX_CALLS_MAX;

  const isDirty =
    enabled !== (ai?.enabled ?? AI_SETTINGS_DEFAULTS.enabled) ||
    model !== (ai?.model ?? AI_SETTINGS_DEFAULTS.model) ||
    parsedMaxCalls !==
      (ai?.maxCallsPerUserPerDay ??
        AI_SETTINGS_DEFAULTS.maxCallsPerUserPerDay);

  const trimmedNewKey = newApiKey.trim();
  const newKeyValid =
    trimmedNewKey.length >= AI_API_KEY_MIN_LENGTH &&
    trimmedNewKey.length <= AI_API_KEY_MAX_LENGTH;

  const controlsDisabled = disabled || isSaving;

  const run = async (action: () => Promise<void>, message: string) => {
    setFormError(null);
    setSuccessMessage(null);
    try {
      await action();
      setSuccessMessage(message);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  // Saves the non-secret fields ONLY. `apiKey` is deliberately absent from
  // this payload so that an unrelated edit can never clear a working key.
  const handleSaveSettings = () =>
    run(
      () =>
        updateAiSettings({
          enabled,
          model: model.trim(),
          maxCallsPerUserPerDay: parsedMaxCalls,
        }),
      'AI settings saved',
    );

  // Sends the plaintext key and nothing else, then drops it from component state.
  const handleSaveKey = () =>
    run(async () => {
      await updateAiSettings({ apiKey: trimmedNewKey });
      setNewApiKey('');
      setShowApiKey(false);
    }, 'API key saved');

  // Explicit null clears the stored key. Also forces the feature off, so the
  // instance is never left "enabled" with no credential behind it.
  const handleRemoveKey = () => {
    setConfirmRemoveOpen(false);
    return run(
      () => updateAiSettings({ apiKey: null, enabled: false }),
      'API key removed',
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={32} />
          </Box>
        </CardContent>
      </Card>
    );
  }

  const updatedAtLabel = formatUpdatedAt(ai?.apiKeyUpdatedAt ?? null);

  return (
    <>
      <Card id="ai">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            AI Card Recognition
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            Use OpenAI to read card images automatically. Configured once for
            the whole instance.
          </Typography>

          <Alert severity="warning" icon={false} sx={{ mb: 3 }}>
            <Typography variant="subtitle2" gutterBottom>
              This sends card images to OpenAI
            </Typography>
            <Typography variant="body2">
              When enabled, card images uploaded to this instance are
              transmitted to OpenAI&apos;s servers for processing. This applies
              to <strong>every user of this instance</strong>, not just you, and
              they are not asked separately. Card images can contain personal
              and financial details. This feature is <strong>off by
              default</strong> - leave it off unless sending that data to a
              third party is acceptable for your deployment.
            </Typography>
          </Alert>

          {/* The hook mirrors save failures into `error` as well, so show a
              single Alert rather than the same message twice. */}
          {(formError || error) && (
            <Alert
              severity="error"
              sx={{ mb: 2 }}
              onClose={formError ? () => setFormError(null) : undefined}
            >
              {formError || error}
            </Alert>
          )}
          {successMessage && (
            <Alert
              severity="success"
              sx={{ mb: 2 }}
              onClose={() => setSuccessMessage(null)}
            >
              {successMessage}
            </Alert>
          )}

          {/* ---------------- API key ---------------- */}
          <Typography variant="subtitle2" gutterBottom>
            OpenAI API key
          </Typography>

          {apiKeyConfigured ? (
            <Box sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <KeyIcon fontSize="small" color="action" />
                <Typography
                  variant="body2"
                  sx={{ fontFamily: 'monospace' }}
                  data-testid="ai-api-key-mask"
                >
                  {`•••• ${ai?.apiKeyLast4 ?? ''}`.trim()}
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary">
                {updatedAtLabel
                  ? `Updated ${updatedAtLabel}`
                  : 'Update date unavailable'}
              </Typography>
            </Box>
          ) : (
            <Alert severity="info" sx={{ mb: 2 }}>
              No API key is configured. AI card recognition cannot run until you
              add one.
            </Alert>
          )}

          <Typography variant="body2" color="text.secondary" paragraph>
            The key is stored encrypted and never shown again after saving.
            {apiKeyConfigured
              ? ' Entering a new key replaces the existing one.'
              : ''}
          </Typography>

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            alignItems={{ xs: 'stretch', sm: 'flex-start' }}
            sx={{ mb: 1 }}
          >
            <TextField
              label={apiKeyConfigured ? 'Replace API key' : 'Set API key'}
              type={showApiKey ? 'text' : 'password'}
              value={newApiKey}
              onChange={(e) => setNewApiKey(e.target.value)}
              disabled={controlsDisabled}
              fullWidth
              size="small"
              autoComplete="off"
              placeholder="sk-..."
              error={trimmedNewKey.length > 0 && !newKeyValid}
              helperText={
                trimmedNewKey.length > 0 && !newKeyValid
                  ? `Key must be between ${AI_API_KEY_MIN_LENGTH} and ${AI_API_KEY_MAX_LENGTH} characters`
                  : ' '
              }
              InputProps={{
                sx: { fontFamily: 'monospace' },
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowApiKey((v) => !v)}
                      edge="end"
                      size="small"
                      aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                    >
                      {showApiKey ? (
                        <VisibilityOffIcon fontSize="small" />
                      ) : (
                        <VisibilityIcon fontSize="small" />
                      )}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
            <Button
              variant="contained"
              onClick={handleSaveKey}
              disabled={controlsDisabled || !newKeyValid}
              sx={{ flexShrink: 0 }}
            >
              {apiKeyConfigured ? 'Replace key' : 'Save key'}
            </Button>
          </Stack>

          {apiKeyConfigured && (
            <Button
              variant="outlined"
              color="error"
              size="small"
              onClick={() => setConfirmRemoveOpen(true)}
              disabled={controlsDisabled}
            >
              Remove key
            </Button>
          )}

          <Divider sx={{ my: 3 }} />

          {/* ---------------- Feature configuration ---------------- */}
          <Typography variant="subtitle2" gutterBottom>
            Configuration
          </Typography>

          <Tooltip
            title={
              apiKeyConfigured
                ? ''
                : 'Add an API key first - enabling this without a key does nothing.'
            }
          >
            {/* span wrapper: MUI tooltips do not fire on disabled controls */}
            <span
              style={{ display: 'inline-block' }}
              data-testid="ai-enable-toggle-wrapper"
            >
              <FormControlLabel
                control={
                  <Switch
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    disabled={controlsDisabled || !apiKeyConfigured}
                  />
                }
                label="Enable AI card recognition"
              />
            </span>
          </Tooltip>

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ mt: 2, mb: 2 }}
          >
            <TextField
              label="Model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={controlsDisabled}
              size="small"
              fullWidth
              error={model.trim() === ''}
              helperText={model.trim() === '' ? 'Model is required' : ' '}
            />
            <TextField
              label="Max calls per user per day"
              type="number"
              value={maxCalls}
              onChange={(e) => setMaxCalls(e.target.value)}
              disabled={controlsDisabled}
              size="small"
              fullWidth
              inputProps={{
                min: AI_MAX_CALLS_MIN,
                max: AI_MAX_CALLS_MAX,
                step: 1,
              }}
              error={!maxCallsValid}
              helperText={
                maxCallsValid
                  ? ' '
                  : `Enter a whole number between ${AI_MAX_CALLS_MIN} and ${AI_MAX_CALLS_MAX}`
              }
            />
          </Stack>

          <Button
            variant="contained"
            onClick={handleSaveSettings}
            disabled={
              controlsDisabled ||
              !isDirty ||
              !maxCallsValid ||
              model.trim() === ''
            }
          >
            {isSaving ? 'Saving...' : 'Save changes'}
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={confirmRemoveOpen}
        onClose={() => setConfirmRemoveOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Remove the OpenAI API key?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This deletes the stored credential and turns AI card recognition off
            for every user of this instance. The key cannot be recovered - you
            will need to paste a new one to turn the feature back on.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRemoveOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleRemoveKey}>
            Remove key
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
