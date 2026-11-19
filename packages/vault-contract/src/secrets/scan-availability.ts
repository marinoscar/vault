import { z } from 'zod';

// =============================================================================
// Scan model choice and availability (issue #213, IDOC-10)
// =============================================================================
//
// ONE rule, shared by the API (`@marinoscar/vault-api/ai`: the onboarding fact,
// `GET /api/secrets/scan/targets`) and the web (`useAiStatus`), so the scan entry
// points and the server never disagree. Pure: no I/O, no framework.
//
// Scanning is a question about the MODEL the target resolver picks for the
// feature, not about a vendor: any provider whose model declares the needs
// (`vision_input`, `structured_output`, `responses`) and whose call can be paid
// (a deployment key under `byok_with_org_fallback`, or a keyless
// OpenAI-compatible server) can scan.
// =============================================================================

/**
 * The two registered AI features that read photographs (`app-registrations/ai.ts`
 * of the API). Permanent ids: usage rows carry them.
 *
 * @stability experimental
 */
export const SCAN_AI_FEATURES = ['card_extract', 'document_extract'] as const;

/** One of {@link SCAN_AI_FEATURES}. @stability experimental */
export type ScanAiFeature = (typeof SCAN_AI_FEATURES)[number];

/**
 * What both scan features need from a model (their `needs` at registration). The
 * platform refuses a model that lacks one, so availability and the model pickers
 * apply the same list. `responses` is the platform's responses PORT (any adapter
 * with one offers it, including an OpenAI-compatible server on either API style),
 * not OpenAI's Responses endpoint.
 *
 * @stability experimental
 */
export const SCAN_MODEL_NEEDS = ['responses', 'structured_output', 'vision_input'] as const;

/**
 * The provider a stored model id means when no provider is stored beside it: every
 * row written before #213 named an OpenAI model.
 *
 * @stability experimental
 */
export const DEFAULT_SCAN_PROVIDER = 'openai';

/**
 * The fields of the `ai` system-settings namespace that choose the scan models
 * (Vault's extension of the platform AI policy). Every field may be missing or
 * `null` (a cleared document choice).
 *
 * @stability experimental
 */
export interface ScanModelSettings {
  /** The model `card_extract` runs on. */
  cardExtractModel?: string | null;
  /** Its provider; unset means {@link DEFAULT_SCAN_PROVIDER}. */
  cardExtractProvider?: string | null;
  /** The model `document_extract` runs on; unset means the card choice. */
  documentExtractModel?: string | null;
  /** Its provider; unset means {@link DEFAULT_SCAN_PROVIDER}. */
  documentExtractProvider?: string | null;
}

/** A provider and model id pair. @stability experimental */
export interface ScanModelRef {
  provider: string;
  model: string;
}

function clean(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The model a scan feature runs on, from the settings: `document_extract` takes
 * `documentExtractModel` (with its provider) and falls back to the card choice when
 * it is unset. `null` when nothing is chosen.
 *
 * @stability experimental
 */
export function resolveScanModelRef(
  settings: ScanModelSettings | null | undefined,
  feature: ScanAiFeature,
): ScanModelRef | null {
  const s = settings ?? {};
  if (feature === 'document_extract') {
    const model = clean(s.documentExtractModel);
    if (model) return { provider: clean(s.documentExtractProvider) || DEFAULT_SCAN_PROVIDER, model };
  }
  const model = clean(s.cardExtractModel);
  if (!model) return null;
  return { provider: clean(s.cardExtractProvider) || DEFAULT_SCAN_PROVIDER, model };
}

/**
 * The model one scan feature runs on, with the capabilities the deployment's model
 * catalogue declares for it. `capabilities` is `null` when the model is not an
 * enabled, current model of the catalogue (not found, disabled or deprecated).
 *
 * @stability experimental
 */
export const scanTargetSchema = z.object({
  provider: z.string(),
  model: z.string(),
  capabilities: z.array(z.string()).nullable(),
});

/** @stability experimental */
export type ScanTarget = z.infer<typeof scanTargetSchema>;

/**
 * `GET /api/secrets/scan/targets`: the model each scan feature runs on (`null`
 * when no model is chosen). No key, no setting beyond the model choice.
 *
 * @stability experimental
 */
export const scanTargetsSchema = z.object({
  card_extract: scanTargetSchema.nullable(),
  document_extract: scanTargetSchema.nullable(),
});

/** @stability experimental */
export type ScanTargets = z.infer<typeof scanTargetsSchema>;

/**
 * The part of the platform's public AI config (`GET /api/ai/config`,
 * `AiConfigService.describePublic`) the rule reads.
 *
 * @stability experimental
 */
export interface ScanAvailabilityConfig {
  enabled: boolean;
  keyPolicy: string;
  providers: ReadonlyArray<{
    id: string;
    enabled: boolean;
    hasOrgKey: boolean;
    /** `false` only for a keyless OpenAI-compatible server; absent means a key is needed. */
    requiresKey?: boolean;
  }>;
}

/**
 * What {@link isScanAvailable} decides from: the public AI config of the caller's
 * organization and the targets of the scan features.
 *
 * @stability experimental
 */
export interface ScanAvailabilityInput {
  config: ScanAvailabilityConfig | null | undefined;
  /**
   * The targets (`GET /api/secrets/scan/targets`). OMITTED means "not known": the
   * pre-#213 assumption applies (an OpenAI model that can scan), which is how the
   * deprecated `isCardScanAvailable(config)` keeps its old answers.
   */
  targets?: Partial<ScanTargets> | null;
}

/** The target assumed when the caller passes no targets (the pre-#213 rule). */
const LEGACY_TARGET: ScanTarget = {
  provider: DEFAULT_SCAN_PROVIDER,
  model: '',
  capabilities: [...SCAN_MODEL_NEEDS],
};

/** Whether `capabilities` declares every capability a scan needs. @stability experimental */
export function scanModelFits(capabilities: readonly string[] | null | undefined): boolean {
  return Array.isArray(capabilities) && SCAN_MODEL_NEEDS.every((need) => capabilities.includes(need));
}

function isInput(value: unknown): value is ScanAvailabilityInput {
  return value !== null && typeof value === 'object' && 'config' in value;
}

/**
 * Whether a scan feature is usable, all of:
 *
 *  1. AI is on for the organization (the kill switch);
 *  2. the feature's model is an enabled catalogue model on an ENABLED provider and
 *     declares `vision_input`, `structured_output` and `responses`;
 *  3. its call can be paid: the provider is keyless (`requiresKey: false`), or the
 *     key policy is `byok_with_org_fallback` (Vault users hold no key of their own)
 *     and the deployment key for that provider is stored.
 *
 * Says nothing about the viewer: the `ai:use` permission is the caller's to combine.
 * Pure, and FAILS CLOSED on anything malformed. A bare config (no `targets`) is
 * read with the pre-#213 assumption, see {@link ScanAvailabilityInput.targets}.
 *
 * @stability experimental
 */
export function isScanAvailable(
  input: ScanAvailabilityInput | ScanAvailabilityConfig | null | undefined,
  feature: ScanAiFeature,
): boolean {
  if (!input) return false;
  const { config, targets } = isInput(input) ? input : { config: input, targets: undefined };
  if (!config || config.enabled !== true || !Array.isArray(config.providers)) return false;

  const target = targets === undefined ? LEGACY_TARGET : (targets?.[feature] ?? null);
  if (!target || typeof target.provider !== 'string') return false;
  if (!scanModelFits(target.capabilities)) return false;

  const provider = config.providers.find((p) => p.id === target.provider);
  if (!provider || provider.enabled !== true) return false;
  if (provider.requiresKey === false) return true;
  return config.keyPolicy === 'byok_with_org_fallback' && provider.hasOrgKey === true;
}
