import { useEffect, useState } from 'react';
import {
  Alert,
  AlertTitle,
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
import { verifyAiConnection } from '../../services/api';
import {
  AI_API_KEY_MAX_LENGTH,
  AI_API_KEY_MIN_LENGTH,
  AI_MAX_CALLS_MAX,
  AI_MAX_CALLS_MIN,
  AI_SETTINGS_DEFAULTS,
  AiVerifyResult,
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

interface VerifyMessage {
  severity: 'success' | 'error';
  title: string;
  detail: string;
}

/**
 * The model a result describes.
 *
 * The API echoes back what it actually probed, and that is authoritative - on
 * success it is often the provider's dated snapshot id rather than the alias
 * that was asked for. `requestedModel` is only a fallback for the paths where
 * nothing came back at all (a transport failure, or an HTTP error raised before
 * the probe ran).
 */
function probedModelOf(result: AiVerifyResult, requestedModel: string): string {
  return result.model || requestedModel.trim();
}

/**
 * Turn a verify result into copy an admin can act on.
 *
 * Every reason gets its own text on purpose. "It didn't work" sends someone
 * to check the key, the model name, the billing page and the firewall in turn;
 * naming the failing half tells them which one to open. The model that was
 * tested is always named, because the most common real failure here is a model
 * id that is merely a typo away from a working one.
 */
function describeVerifyResult(
  result: AiVerifyResult,
  requestedModel: string,
): VerifyMessage {
  const model = probedModelOf(result, requestedModel) || 'the configured model';

  if (result.ok) {
    const seconds =
      result.durationMs > 0
        ? ` The call took ${(result.durationMs / 1000).toFixed(1)}s.`
        : '';

    return {
      severity: 'success',
      title: `Connection works: ${model}`,
      detail:
        `The API key was accepted and ${model} accepted an image, ` +
        `which is the combination card import needs.${seconds}`,
    };
  }

  switch (result.reason) {
    case 'invalid_key':
      return {
        severity: 'error',
        title: 'The API key was rejected',
        detail:
          'OpenAI did not accept the stored key. It may have been revoked, ' +
          'expired, or belong to a different account. Paste a replacement key ' +
          'above and test again. The model was not reached, so it has not ' +
          'been checked.',
      };
    case 'model_not_found':
      return {
        severity: 'error',
        title: `Model not found: ${model}`,
        detail:
          'The API key works, but OpenAI does not recognise this model name ' +
          'on this account. Model ids are case-sensitive, and some are only ' +
          'available on paid accounts. Check the exact id in the OpenAI ' +
          'dashboard, correct the Model field above, and test again before ' +
          'saving.',
      };
    case 'model_no_image_support':
      return {
        severity: 'error',
        title: `${model} does not accept images`,
        detail:
          'The API key works and the model exists, but it cannot read image ' +
          'input. Card import sends photos, so it needs a vision-capable ' +
          'model such as gpt-4o-mini.',
      };
    case 'model_no_structured_output':
      return {
        severity: 'error',
        title: `${model} does not support structured output`,
        detail:
          'The API key works and the model reads images, but it cannot ' +
          'return the structured JSON that card import relies on. Choose a ' +
          'newer model such as gpt-4o-mini.',
      };
    case 'quota':
      return {
        severity: 'error',
        title: 'OpenAI refused on quota or rate limits',
        detail:
          'The API key is valid, but OpenAI declined for quota, billing or ' +
          'rate-limiting reasons. Nothing needs changing here - check the ' +
          'account balance and limits, then test again.',
      };
    case 'network':
      return {
        severity: 'error',
        title: 'Could not reach OpenAI',
        detail:
          'The request did not complete, so neither the key nor the model was ' +
          'checked. This is not a sign that either is wrong - it usually means ' +
          'a network or timeout problem between this server and OpenAI. Try ' +
          'again in a moment.',
      };
    default:
      return {
        severity: 'error',
        title: 'The connection test failed',
        detail:
          `The test against ${model} did not succeed, and the reason was not ` +
          'one this page recognises. The detail below comes from the server.',
      };
  }
}

interface VerifyResultAlertProps {
  result: AiVerifyResult;
  /**
   * The model name this particular run asked for - the Model field as it stood
   * at the click, or the stored model when that field was blank. Used to label
   * the result and as a fallback when the API echoed no model back.
   */
  requestedModel: string;
  onClose: () => void;
}

function VerifyResultAlert({
  result,
  requestedModel,
  onClose,
}: VerifyResultAlertProps) {
  const { severity, title, detail } = describeVerifyResult(
    result,
    requestedModel,
  );

  // Which model this result is about, stated once, in the same place, for every
  // outcome. The titles name the model where it is the thing at fault, but
  // `invalid_key`, `quota` and `network` do not - and now that the button
  // probes unsaved input, "the model" is no longer a thing the admin can look
  // up elsewhere on the page. Someone trying four candidate names in a row must
  // be able to tell at a glance which one an alert belongs to.
  const probed = probedModelOf(result, requestedModel);
  const asked = requestedModel.trim();
  let testedLabel: string;
  if (!probed) {
    testedLabel = 'Tested the model saved in system settings.';
  } else if (asked && asked !== probed) {
    // The provider resolved the alias to something more specific. Show both:
    // the name the admin typed is how they recognise the result, the resolved
    // id is what actually answered.
    testedLabel = `Tested: ${asked} (OpenAI reported ${probed})`;
  } else {
    testedLabel = `Tested: ${probed}`;
  }

  // The server's own words are shown alongside ours rather than instead of
  // them: our copy says what to do, the server's says what actually happened,
  // and dropping the latter is how a diagnosable failure becomes a mystery.
  const serverMessage = result.ok ? null : result.message.trim() || null;

  // A non-empty list means this model refused one of the request parameters
  // and the API resent without it. The call worked, but a setting is being
  // ignored, and an admin who is never told will not know why behaviour
  // differs from another model.
  const adapted = result.adaptedParameters ?? [];

  return (
    <Alert
      severity={severity}
      onClose={onClose}
      sx={{ mb: 2 }}
      data-testid="ai-verify-result"
    >
      <AlertTitle>{title}</AlertTitle>
      <Typography
        variant="body2"
        sx={{ fontWeight: 600, mb: 0.5 }}
        data-testid="ai-verify-tested-model"
      >
        {testedLabel}
      </Typography>
      <Typography variant="body2">{detail}</Typography>
      {serverMessage && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mt: 1 }}
          data-testid="ai-verify-server-message"
        >
          {serverMessage}
        </Typography>
      )}
      {adapted.length > 0 && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mt: 1 }}
          data-testid="ai-verify-adapted-parameters"
        >
          {`This model rejected ${adapted.join(', ')}, so the request was ` +
            'resent without it. Card import works, but those settings are ' +
            'ignored for this model.'}
        </Typography>
      )}
    </Alert>
  );
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

  /**
   * Outcome of the last explicit "Test connection" click.
   *
   * The model that was asked for is captured WITH the result rather than read
   * from `model` at render time. The field is editable while a result is on
   * screen, so reading it later would relabel an old result with a new name -
   * exactly the misreading this feature exists to prevent.
   */
  const [verifyAttempt, setVerifyAttempt] = useState<{
    requestedModel: string;
    result: AiVerifyResult;
  } | null>(null);

  /**
   * The model name currently being probed, or null when no check is in flight.
   *
   * Held rather than read from `model` at render time for the same reason: the
   * field stays editable during the call, and the "calling OpenAI with..."
   * line must keep naming what was actually sent.
   */
  const [verifyingModel, setVerifyingModel] = useState<string | null>(null);
  const isVerifying = verifyingModel !== null;

  /**
   * Drop the previous verify result.
   *
   * A result describes one specific (key, model) pair at one moment. The
   * instant either half is edited it becomes a claim about a configuration
   * that is no longer on screen, and a green tick sitting next to an untested
   * model name is worse than no tick at all - it is the reassurance the admin
   * came here for, attached to the wrong thing.
   */
  const clearVerifyResult = () => setVerifyAttempt(null);

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
    // Any save can move the key or the model, so the previous test result no
    // longer describes what is stored.
    clearVerifyResult();
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

  /**
   * The ONLY place the verify endpoint is called.
   *
   * It makes a real, billable request upstream, so it hangs off a click and
   * nothing else - no effect, no blur, no piggybacking on save.
   * `verifyAiConnection` resolves for every outcome including transport
   * failure, so there is no error path that can end up rendering nothing.
   *
   * The Model FIELD is what gets probed, not the saved setting. Testing a name
   * before committing it is the entire reason this button exists: an admin who
   * types a candidate and is told about the model they are replacing has been
   * answered a question they did not ask. Only the model is sent - the stored
   * key is what it is probed against, and the key never leaves the server.
   *
   * A blank field sends no override at all, so the API falls back to the stored
   * model. `requestedModel` records the stored name in that case so the result
   * is still labelled with something.
   */
  const handleTestConnection = async () => {
    const candidate = model.trim();
    const requestedModel = candidate || (ai?.model ?? '');

    setVerifyAttempt(null);
    setVerifyingModel(requestedModel);
    try {
      const result = await verifyAiConnection(
        candidate ? { model: candidate } : {},
      );
      setVerifyAttempt({ requestedModel, result });
    } finally {
      setVerifyingModel(null);
    }
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
              onChange={(e) => {
                setNewApiKey(e.target.value);
                // Typing a replacement key means the tested credential is no
                // longer the one the admin is looking at.
                clearVerifyResult();
              }}
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
              onChange={(e) => {
                setModel(e.target.value);
                clearVerifyResult();
              }}
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

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            alignItems={{ xs: 'stretch', sm: 'center' }}
            sx={{ mb: 2 }}
          >
            <Button
              variant="contained"
              onClick={handleSaveSettings}
              disabled={
                controlsDisabled ||
                isVerifying ||
                !isDirty ||
                !maxCallsValid ||
                model.trim() === ''
              }
            >
              {isSaving ? 'Saving...' : 'Save changes'}
            </Button>

            <Tooltip
              title={
                apiKeyConfigured
                  ? 'Makes one real request to OpenAI using the saved key and the model in the field above, even if that model has not been saved yet.'
                  : 'Add an API key first - there is nothing to test yet.'
              }
            >
              {/* span wrapper: MUI tooltips do not fire on disabled controls */}
              <span
                style={{ display: 'inline-block' }}
                data-testid="ai-test-connection-wrapper"
              >
                <Button
                  variant="outlined"
                  onClick={handleTestConnection}
                  // Deliberately NOT gated on `isDirty` or on the settings
                  // being valid to save: testing a model the admin has typed
                  // but not saved is the point of the button. The only gates
                  // are the ones that make the call impossible or meaningless -
                  // no stored key to authenticate with, a save in progress
                  // (`controlsDisabled`), or a check already running.
                  disabled={controlsDisabled || isVerifying || !apiKeyConfigured}
                  aria-busy={isVerifying}
                  startIcon={
                    isVerifying ? (
                      <CircularProgress size={16} color="inherit" />
                    ) : undefined
                  }
                >
                  {/* Label stays constant while in flight so the accessible
                      name does not move under assistive tech mid-request. */}
                  Test connection
                </Button>
              </span>
            </Tooltip>
          </Stack>

          {isVerifying && (
            <Typography
              variant="body2"
              color="text.secondary"
              data-testid="ai-verify-pending"
            >
              {verifyingModel
                ? `Calling OpenAI with the saved key and ${verifyingModel}...`
                : 'Calling OpenAI with the saved key and the saved model...'}
            </Typography>
          )}

          {verifyAttempt && !isVerifying && (
            <VerifyResultAlert
              result={verifyAttempt.result}
              requestedModel={verifyAttempt.requestedModel}
              onClose={clearVerifyResult}
            />
          )}
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
