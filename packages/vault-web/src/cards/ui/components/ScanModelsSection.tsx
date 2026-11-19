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
import { createPlatformApiClient } from '@marinoscar/platform-web/core';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';
import { useAiConfig, useAiModels } from '@marinoscar/platform-web/ai/headless';
import type { AiModel, AiPublicConfig } from '@marinoscar/platform-web/ai/headless';
import { DEFAULT_SCAN_PROVIDER, SCAN_MODEL_NEEDS } from '@marinoscar/vault-contract/secrets';

import { useSystemSettings } from '../../../core/headless/useSystemSettings.js';
import { api, getVaultProductName } from '../../../core/headless/http.js';

/** A provider and model id pair, as the pickers store it. */
export interface ScanModelChoice {
  provider: string;
  model: string;
}

/**
 * The models a scan picker offers: enabled, not deprecated, declaring every
 * capability the scan features need (`SCAN_MODEL_NEEDS`), once per provider and
 * model id. With `enabledProviders` only those providers' models are kept (every
 * enabled provider, not only OpenAI: an OpenAI-compatible server too, #213).
 */
export function scanModelCandidates(
  models: readonly AiModel[],
  enabledProviders?: ReadonlySet<string> | null,
): AiModel[] {
  const seen = new Set<string>();
  const out: AiModel[] = [];
  for (const model of models) {
    if (!model.enabled || model.deprecatedAt) continue;
    if (enabledProviders && !enabledProviders.has(model.provider)) continue;
    const caps = model.capabilities?.capabilities ?? [];
    if (!SCAN_MODEL_NEEDS.every((need) => caps.includes(need))) continue;
    const key = choiceKey({ provider: model.provider, model: model.modelId });
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(model);
  }
  return out;
}

/** The select value of a choice (a provider id and a model id may both contain any character). */
function choiceKey(choice: ScanModelChoice): string {
  return JSON.stringify([choice.provider, choice.model]);
}

/** The enabled providers of the public AI config; `null` (no filter) while AI is off or unknown. */
function enabledProviderIds(config: AiPublicConfig): Set<string> | null {
  if (config.enabled !== true || !Array.isArray(config.providers) || config.providers.length === 0) return null;
  return new Set(config.providers.filter((p) => p.enabled).map((p) => p.id));
}

/** The model catalogue page (the packaged `AiModelsPage`, its card in `adminSections.tsx`). */
const MODELS_PATH = '/admin/settings/ai/models';

/** The value of the document picker's "Same as card scanning" option. */
const SAME_AS_CARD = 'same-as-card';

const vaultAiApi = createPlatformApiClient(api);

interface ScanModelPickerProps {
  id: string;
  title: string;
  description: string;
  helperText: string;
  /** The stored choice; `null` is "Same as card scanning" (document picker only). */
  stored: ScanModelChoice | null;
  /** Offer "Same as card scanning" (clears the choice). */
  sameAsCardOption?: boolean;
  candidates: AiModel[];
  providerName: (id: string) => string;
  canWrite: boolean;
  isSaving: boolean;
  modelsError: string | null;
  onSave: (choice: ScanModelChoice | null) => Promise<void>;
  savedMessage: string;
}

function ScanModelPicker(props: ScanModelPickerProps) {
  const { stored, candidates, sameAsCardOption, canWrite, isSaving, modelsError } = props;
  const storedKey = stored ? choiceKey(stored) : SAME_AS_CARD;
  const [selected, setSelected] = useState(storedKey);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setSelected(storedKey);
  }, [storedKey]);

  const byKey = useMemo(
    () => new Map(candidates.map((m) => [choiceKey({ provider: m.provider, model: m.modelId }), m])),
    [candidates],
  );
  const storedListed = stored === null || byKey.has(storedKey);

  const handleSave = async () => {
    setSaveError(null);
    let choice: ScanModelChoice | null = null;
    if (selected !== SAME_AS_CARD) {
      const model = byKey.get(selected);
      choice = model ? { provider: model.provider, model: model.modelId } : stored;
    }
    try {
      await props.onSave(choice);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : `Failed to save the ${props.title.toLowerCase()}`);
    }
  };

  const label = (model: AiModel) => {
    const name =
      model.displayName && model.displayName !== model.modelId ? `${model.displayName} (${model.modelId})` : model.modelId;
    return `${name} · ${props.providerName(model.provider)}`;
  };

  return (
    <Box component="section" aria-labelledby={`${props.id}-heading`}>
      <Typography id={`${props.id}-heading`} variant="subtitle1" component="h3" sx={{ fontWeight: 600 }} gutterBottom>
        {props.title}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {props.description}
      </Typography>
      {!storedListed && !modelsError && stored && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          The saved model, {stored.model} ({props.providerName(stored.provider)}), is not an enabled model that can scan.
          Scans will fail until you pick one below or enable it on AI models.
        </Alert>
      )}
      <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' }, alignItems: { sm: 'flex-start' } }}>
        <TextField
          select
          fullWidth
          id={`${props.id}-select`}
          label={props.title}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={!canWrite || isSaving}
          helperText={props.helperText}
        >
          {sameAsCardOption && <MenuItem value={SAME_AS_CARD}>Same as card scanning</MenuItem>}
          {!storedListed && stored && (
            <MenuItem value={storedKey}>
              {stored.model} · {props.providerName(stored.provider)} (not available)
            </MenuItem>
          )}
          {candidates.map((model) => (
            <MenuItem key={model.id} value={choiceKey({ provider: model.provider, model: model.modelId })}>
              {label(model)}
            </MenuItem>
          ))}
        </TextField>
        <Button
          variant="contained"
          onClick={() => void handleSave()}
          disabled={!canWrite || isSaving || selected === storedKey || (!sameAsCardOption && selected === SAME_AS_CARD)}
          sx={{ minHeight: 56, flexShrink: 0 }}
          aria-label={`Save ${props.title.toLowerCase()}`}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
      </Box>
      {saveError && (
        <Alert severity="error" sx={{ mt: 2 }} onClose={() => setSaveError(null)}>
          {saveError}
        </Alert>
      )}
      <Snackbar open={saved} autoHideDuration={4000} onClose={() => setSaved(false)} message={props.savedMessage} />
    </Box>
  );
}

/**
 * Vault's scan-model settings on the packaged AI page (#88, generalised in #213):
 * two pickers, "Card scanning model" (`ai.cardExtractModel` and its provider) and
 * "Document scanning model" (`ai.documentExtractModel` and its provider, with
 * "Same as card scanning", which clears it). Rendered in the `AfterContent` slot
 * of the packaged `AiConfigPage` (`pages/AiSettingsPage.tsx`): a section of that
 * page, never a tab, no settings card of its own.
 *
 * Both list the models of EVERY enabled provider that declare what scanning needs
 * (`GET /api/admin/ai/models`, filtered by `SCAN_MODEL_NEEDS`), OpenAI and an
 * OpenAI-compatible server alike, showing provider and model. A stored model that
 * is no longer among them stays selected and is flagged. Saves go through
 * `PATCH /api/system-settings` (`If-Match`). The page's card is `ai_config:read`;
 * the controls are gated by `ai_config:write` (and the settings route's own
 * `system_settings:write`); reading the choice needs `system_settings:read`.
 */
export function ScanModelsSection() {
  const { hasPermission } = usePermissions();
  const canRead = hasPermission('system_settings:read');
  const canWrite = hasPermission('ai_config:write') && hasPermission('system_settings:write');

  const { settings, isLoading, error, isSaving, updateCardExtractModel, updateDocumentExtractModel } =
    useSystemSettings();
  const { models, isLoading: modelsLoading, error: modelsError } = useAiModels({
    enabled: true,
    capability: 'vision_input',
    pageSize: 100,
  });
  const { config } = useAiConfig({ api: vaultAiApi });

  const providers = useMemo(() => enabledProviderIds(config), [config]);
  const candidates = useMemo(() => scanModelCandidates(models, providers), [models, providers]);
  const providerName = (id: string) => config.providers?.find((p) => p.id === id)?.displayName ?? id;

  if (!canRead) return null;

  const ai = settings?.ai ?? null;
  const cardStored: ScanModelChoice | null =
    typeof ai?.cardExtractModel === 'string' && ai.cardExtractModel !== ''
      ? { provider: ai.cardExtractProvider || DEFAULT_SCAN_PROVIDER, model: ai.cardExtractModel }
      : null;
  const documentStored: ScanModelChoice | null =
    typeof ai?.documentExtractModel === 'string' && ai.documentExtractModel !== ''
      ? { provider: ai.documentExtractProvider || DEFAULT_SCAN_PROVIDER, model: ai.documentExtractModel }
      : null;

  const busy = isLoading || modelsLoading;

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mt: 3 }} component="section" aria-labelledby="scan-models-heading">
      <Typography id="scan-models-heading" variant="h6" component="h2" gutterBottom>
        Scanning models
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        The models {getVaultProductName()} reads photos with. A model must be enabled on{' '}
        <Link component={RouterLink} to={MODELS_PATH}>
          AI models
        </Link>{' '}
        and declare image input and structured output. Any enabled provider works, an on-premises
        OpenAI-compatible server included.
      </Typography>

      {busy ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={28} aria-label="Loading the scanning models" />
        </Box>
      ) : (
        <>
          {(error || modelsError) && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error ?? modelsError}
            </Alert>
          )}
          {candidates.length === 0 && !modelsError && (
            <Alert severity="info" sx={{ mb: 2 }}>
              No enabled model can scan yet. Enable one on AI models (it must accept images and structured output),
              then choose it here.
            </Alert>
          )}
          {!canWrite && (
            <Alert severity="info" sx={{ mb: 2 }}>
              You can see these settings but not change them (needs ai_config:write).
            </Alert>
          )}
          <ScanModelPicker
            id="card-scan-model"
            title="Card scanning model"
            description="Reads payment card photos. The card security code is never read or sent."
            helperText="Used for every card scan in this deployment."
            stored={cardStored}
            candidates={candidates}
            providerName={providerName}
            canWrite={canWrite}
            isSaving={isSaving}
            modelsError={modelsError}
            onSave={(choice) => (choice ? updateCardExtractModel(choice.model, choice.provider) : Promise.resolve())}
            savedMessage="Card scanning model saved"
          />
          <Box sx={{ mt: 3 }}>
            <ScanModelPicker
              id="document-scan-model"
              title="Document scanning model"
              description="Reads passports and other identity documents. Same as card scanning unless you choose another."
              helperText="Used for every passport and ID document scan in this deployment."
              stored={documentStored}
              sameAsCardOption
              candidates={candidates}
              providerName={providerName}
              canWrite={canWrite}
              isSaving={isSaving}
              modelsError={modelsError}
              onSave={(choice) => updateDocumentExtractModel(choice)}
              savedMessage="Document scanning model saved"
            />
          </Box>
        </>
      )}
    </Paper>
  );
}
