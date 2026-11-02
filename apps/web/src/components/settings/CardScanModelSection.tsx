import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Link,
  MenuItem,
  Paper,
  Snackbar,
  TextField,
  Typography,
} from '@mui/material';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';
import { useAiModels } from '@marinoscar/platform-web/ai/headless';
import type { AiModel } from '@marinoscar/platform-web/ai/headless';

import { useSystemSettings } from '../../hooks/useSystemSettings';

/**
 * What the `card_extract` AI feature needs from a model (`app-registrations/ai.ts`
 * in the API): the platform refuses a model that lacks one, so only models that
 * declare all three are offered.
 */
export const CARD_EXTRACT_NEEDS = ['responses', 'structured_output', 'vision_input'] as const;

/** The models listed for card scanning: enabled, and able to do what it needs. */
export function cardScanCandidates(models: readonly AiModel[]): AiModel[] {
  const seen = new Set<string>();
  const out: AiModel[] = [];
  for (const model of models) {
    if (!model.enabled || model.deprecatedAt) continue;
    const caps = model.capabilities?.capabilities ?? [];
    if (!CARD_EXTRACT_NEEDS.every((need) => caps.includes(need))) continue;
    if (seen.has(model.modelId)) continue;
    seen.add(model.modelId);
    out.push(model);
  }
  return out;
}

/** The model catalogue page (the packaged `AiModelsPage`, its card in `adminSections.tsx`). */
const MODELS_PATH = '/admin/settings/ai/models';

/**
 * Vault's one AI setting the packaged AI page does not draw (E8.2, issue #88):
 * `ai.cardExtractModel`, the model card scanning runs on (`VaultAiTargetResolver`
 * in the API). Rendered in the `AfterContent` slot of the packaged `AiConfigPage`
 * (`pages/admin/AiSettingsPage.tsx`), a section of that page, never a tab.
 *
 * The choices are the models the platform lists (`GET /api/admin/ai/models`,
 * enabled and image-capable); a stored model that is no longer among them stays
 * selected and is flagged. It saves through `PATCH /api/system-settings`
 * (`{ ai: { cardExtractModel } }`, `If-Match`), so it reads with
 * `system_settings:read` and saves with `system_settings:write`; without the
 * latter the control is visible and disabled.
 */
export function CardScanModelSection() {
  const { hasPermission } = usePermissions();
  const canRead = hasPermission('system_settings:read');
  const canWrite = hasPermission('system_settings:write');

  const { settings, isLoading, error, isSaving, updateCardExtractModel } = useSystemSettings();
  const { models, isLoading: modelsLoading, error: modelsError } = useAiModels({
    enabled: true,
    capability: 'vision_input',
    pageSize: 100,
  });

  const stored = typeof settings?.ai?.cardExtractModel === 'string' ? settings.ai.cardExtractModel : '';
  const [selected, setSelected] = useState(stored);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setSelected(stored);
  }, [stored]);

  const candidates = useMemo(() => cardScanCandidates(models), [models]);
  const storedListed = stored === '' || candidates.some((m) => m.modelId === stored);

  if (!canRead) return null;

  const handleSave = async () => {
    setSaveError(null);
    try {
      await updateCardExtractModel(selected);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save the card scanning model');
    }
  };

  const busy = isLoading || modelsLoading;

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mt: 3 }} component="section" aria-labelledby="card-scan-model-heading">
      <Typography id="card-scan-model-heading" variant="h6" component="h2" gutterBottom>
        Card scanning model
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        The model Vault reads card photos with. It must be enabled on{' '}
        <Link component={RouterLink} to={MODELS_PATH}>
          AI models
        </Link>{' '}
        and accept images. The card security code is never read or sent.
      </Typography>

      {busy ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={28} aria-label="Loading the card scanning model" />
        </Box>
      ) : (
        <>
          {(error || modelsError) && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error ?? modelsError}
            </Alert>
          )}
          {!storedListed && !modelsError && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              The saved model, {stored}, is not an enabled model that accepts images. Card scans will fail
              until you pick one below or enable it on AI models.
            </Alert>
          )}
          {candidates.length === 0 && !modelsError && (
            <Alert severity="info" sx={{ mb: 2 }}>
              No enabled model accepts images yet. Enable one on AI models, then choose it here.
            </Alert>
          )}
          {!canWrite && (
            <Alert severity="info" sx={{ mb: 2 }}>
              You can see this setting but not change it (needs system_settings:write).
            </Alert>
          )}
          <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' }, alignItems: { sm: 'flex-start' } }}>
            <TextField
              select
              fullWidth
              label="Model"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={!canWrite || isSaving}
              helperText="Used for every card scan in this deployment."
            >
              {!storedListed && (
                <MenuItem value={stored}>
                  {stored} (not available)
                </MenuItem>
              )}
              {candidates.map((model) => (
                <MenuItem key={model.id} value={model.modelId}>
                  {model.displayName && model.displayName !== model.modelId
                    ? `${model.displayName} (${model.modelId})`
                    : model.modelId}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="contained"
              onClick={() => void handleSave()}
              disabled={!canWrite || isSaving || selected === '' || selected === stored}
              sx={{ minHeight: 56, flexShrink: 0 }}
            >
              {isSaving ? 'Saving…' : 'Save model'}
            </Button>
          </Box>
          {saveError && (
            <Alert severity="error" sx={{ mt: 2 }} onClose={() => setSaveError(null)}>
              {saveError}
            </Alert>
          )}
        </>
      )}

      <Snackbar
        open={saved}
        autoHideDuration={4000}
        onClose={() => setSaved(false)}
        message="Card scanning model saved"
      />
    </Paper>
  );
}
