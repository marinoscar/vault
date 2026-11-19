import { Inject, Injectable } from '@nestjs/common';
import {
  SCAN_AI_FEATURES,
  resolveScanModelRef,
  type ScanAiFeature,
  type ScanModelSettings,
  type ScanTarget,
  type ScanTargets,
} from '@marinoscar/vault-contract/secrets';

import {
  VAULT_AI_CONFIG,
  VAULT_PRISMA,
  VAULT_SETTINGS,
  type VaultAiConfigPort,
  type VaultPrismaClient,
  type VaultSettingsPort,
} from '../ports';
import { isScanAvailable } from './card-scan-availability';

/**
 * The model each scan feature runs on (issue #213, IDOC-10), read the way the host's target
 * resolver reads it: `ai.cardExtractModel` / `ai.cardExtractProvider`, and
 * `ai.documentExtractModel` / `ai.documentExtractProvider` falling back to the card choice
 * (`resolveScanModelRef`). Each target carries the capabilities the model catalogue declares
 * (`ai_models`, a deployment-wide table without row-level security), or `null` when the model is
 * not an enabled, current catalogue model. Nothing here reads or returns a key.
 *
 * @stability experimental
 */
@Injectable()
export class ScanTargetsService {
  constructor(
    @Inject(VAULT_SETTINGS) private readonly settings: VaultSettingsPort,
    @Inject(VAULT_PRISMA) private readonly prisma: VaultPrismaClient,
    @Inject(VAULT_AI_CONFIG) private readonly aiConfig: VaultAiConfigPort,
  ) {}

  /** Both features' targets. */
  async targets(): Promise<ScanTargets> {
    const policy = await this.settings.getNamespace<ScanModelSettings>('ai');
    const entries = await Promise.all(
      SCAN_AI_FEATURES.map(async (feature) => [feature, await this.target(policy, feature)] as const),
    );
    return Object.fromEntries(entries) as ScanTargets;
  }

  /** Whether `feature` is usable in `orgId` (the shared rule over the public config and the targets). */
  async isAvailable(orgId: string | undefined, feature: ScanAiFeature): Promise<boolean> {
    const [config, targets] = await Promise.all([this.aiConfig.describePublic(orgId), this.targets()]);
    return isScanAvailable(config, feature, targets);
  }

  private async target(policy: ScanModelSettings, feature: ScanAiFeature): Promise<ScanTarget | null> {
    const ref = resolveScanModelRef(policy, feature);
    if (!ref) return null;
    const row = await this.prisma.aiModel.findUnique({
      where: { provider_modelId: { provider: ref.provider, modelId: ref.model } },
      select: { enabled: true, deprecatedAt: true, capabilities: true },
    });
    const usable = row !== null && row.enabled && row.deprecatedAt === null;
    return { ...ref, capabilities: usable ? declaredCapabilities(row.capabilities) : null };
  }
}

/** The `capabilities` list of a catalogue row's JSON (`AiModelCapabilities`); `[]` when malformed. */
function declaredCapabilities(json: unknown): string[] {
  const list =
    json !== null && typeof json === 'object' ? (json as { capabilities?: unknown }).capabilities : undefined;
  return Array.isArray(list) ? list.filter((c): c is string => typeof c === 'string') : [];
}
