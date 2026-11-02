import { writeFileSync, existsSync } from 'node:fs';

import { classifyOpenAiModel } from '@marinoscar/platform-api/ai';

import { AI_PROVIDER_ID } from '@marinoscar/vault-api/ai';
import {
  VAULT_AI_CREDENTIAL_NAME,
  VAULT_AI_CREDENTIAL_PURPOSE,
} from '../platform/credentials/credentials.config';
import { DEFAULT_CARD_EXTRACT_MODEL } from '../app-registrations/settings';

// =============================================================================
// vault:migrate-ai-platform (issue #87, E8.1; data step of #88, E8.2)
// =============================================================================
//
// One-time, idempotent rewrite of Vault's own `ai` system-settings block into the
// platform AI slice's shape, plus the catalogue row the platform needs to route a
// call:
//
//   old (system_settings.global.ai)        new
//   enabled                                ai.enabled
//   provider: 'openai'                     dropped (providers.openai.enabled = true)
//   model                                  ai.cardExtractModel, and an ENABLED
//                                          `ai_models` row (openai, <model>)
//   maxCallsPerUserPerDay (N > 0)          ai.limits.perUser.requestsPerDay = N
//   (the 5-per-10-minutes burst limiter)   DROPPED: it was an in-memory per-process
//                                          counter; the platform has per-minute caps
//                                          (ai.limits.perUser.requestsPerMinute), unset
//   (key: credentials ('ai','openai'))     UNCHANGED: already where the slice reads it
//   -                                      ai.keyPolicy = 'byok_with_org_fallback': Vault
//                                          users hold no key of their own, so the
//                                          deployment key must serve every caller
//
// WHAT IT NEVER DOES: read, move, print or rewrite the key; touch any other
// namespace or unknown key of the row; re-enable a model an administrator disabled;
// overwrite a platform field already present (a second run changes nothing).
//
// SEMANTICS THAT CHANGE (documented in docs/runbooks/ai-platform-migration.md):
//   * the daily cap is a UTC calendar day, no longer a rolling 24 hours, and counts
//     every AI call of the user (Vault has only card scans);
//   * `maxCallsPerUserPerDay: 0` meant "scanning blocked": it becomes
//     `ai.enabled = false` (the cap schema takes positive values only);
//   * a legacy `ai.apiKey` ciphertext block that `vault:migrate-ai-key` has not
//     moved yet is a PROBLEM: the command refuses to apply until it has run.
// =============================================================================

const SETTINGS_KEY = 'global';
export const AI_PLATFORM_MIGRATION_AUDIT_ACTION = 'system_settings:ai-platform-migrate';

export interface AiPlatformMigrationPrisma {
  systemSettings: {
    findUnique(args: { where: { key: string } }): Promise<{ id: string; value: unknown; version: number } | null>;
    updateMany(args: {
      where: { key: string; version: number };
      data: { value: unknown; version: { increment: number } };
    }): Promise<{ count: number }>;
  };
  aiModel: {
    findUnique(args: { where: { provider_modelId: { provider: string; modelId: string } } }): Promise<{ enabled: boolean } | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  auditEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
}

export interface AiPlatformMigrationDeps {
  prisma: AiPlatformMigrationPrisma;
  /** Whether the deployment key exists at ('ai', 'openai'). Describes only; never reads the secret. */
  keyConfigured: () => Promise<boolean>;
}

export type AiPlatformMigrationOutcome =
  | 'nothing-to-migrate'
  | 'would-migrate'
  | 'migrated'
  /** Already in the platform shape; only the missing catalogue row (if any) was handled. */
  | 'already-migrated';

export interface AiPlatformMigrationReport {
  apply: boolean;
  outcome: AiPlatformMigrationOutcome;
  /** The block read from the row was Vault's legacy shape. */
  legacyShape: boolean;
  settings: {
    enabled: boolean | null;
    cardExtractModel: string | null;
    requestsPerDay: number | null;
    /** `maxCallsPerUserPerDay` was 0: scanning is switched off instead. */
    blockedByZeroBudget: boolean;
  };
  model: { id: string | null; action: 'created' | 'would-create' | 'exists' | 'none'; enabled: boolean | null };
  keyConfigured: boolean;
  /** Reasons the run refuses to apply (the exit code is non-zero). */
  problems: string[];
  /** Path of the snapshot written by an apply. */
  snapshotPath: string | null;
}

type AiBlock = Record<string, unknown>;

const LEGACY_FIELDS = ['provider', 'model', 'maxCallsPerUserPerDay'] as const;

function readAi(value: unknown): AiBlock | null {
  const ai = (value as { ai?: unknown } | null)?.ai;
  return ai && typeof ai === 'object' && !Array.isArray(ai) ? (ai as AiBlock) : null;
}

function isLegacy(ai: AiBlock): boolean {
  return LEGACY_FIELDS.some((field) => field in ai);
}

/** The platform-shaped block for a legacy one. Pure; exported for the unit spec. */
export function planAiBlock(legacy: AiBlock): {
  next: AiBlock;
  model: string;
  requestsPerDay: number | null;
  blockedByZeroBudget: boolean;
} {
  const model =
    typeof legacy.model === 'string' && legacy.model.trim() ? legacy.model.trim() : DEFAULT_CARD_EXTRACT_MODEL;
  const budget = typeof legacy.maxCallsPerUserPerDay === 'number' ? legacy.maxCallsPerUserPerDay : null;
  const blockedByZeroBudget = budget === 0;

  const next: AiBlock = { ...legacy };
  for (const field of LEGACY_FIELDS) delete next[field];
  // The pre-E4.2 `apiKey` slot (null once moved) has no home in the platform namespace.
  if (next.apiKey === null) delete next.apiKey;

  next.enabled = blockedByZeroBudget ? false : legacy.enabled === true;
  // A platform value already present wins (idempotence, and an admin's later edit).
  next.keyPolicy = typeof legacy.keyPolicy === 'string' ? legacy.keyPolicy : 'byok_with_org_fallback';
  next.providers = {
    ...(legacy.providers as Record<string, unknown> | undefined),
    [AI_PROVIDER_ID]: {
      ...((legacy.providers as Record<string, Record<string, unknown>> | undefined)?.[AI_PROVIDER_ID] ?? {}),
      enabled: true,
    },
  };
  next.cardExtractModel = typeof legacy.cardExtractModel === 'string' ? legacy.cardExtractModel : model;

  const requestsPerDay = budget !== null && budget > 0 ? budget : null;
  if (requestsPerDay !== null) {
    const limits = (legacy.limits as Record<string, any> | undefined) ?? {};
    next.limits = {
      ...limits,
      perUser: { requestsPerDay, ...(limits.perUser ?? {}) },
    };
  }
  return { next, model, requestsPerDay, blockedByZeroBudget };
}

export async function migrateAiPlatform(
  deps: AiPlatformMigrationDeps,
  options: { apply: boolean; snapshotPath?: string },
): Promise<AiPlatformMigrationReport> {
  const { prisma } = deps;
  const { apply } = options;

  const row = await prisma.systemSettings.findUnique({ where: { key: SETTINGS_KEY } });
  const ai = row ? readAi(row.value) : null;
  const keyConfigured = await deps.keyConfigured();

  const report: AiPlatformMigrationReport = {
    apply,
    outcome: 'nothing-to-migrate',
    legacyShape: false,
    settings: { enabled: null, cardExtractModel: null, requestsPerDay: null, blockedByZeroBudget: false },
    model: { id: null, action: 'none', enabled: null },
    keyConfigured,
    problems: [],
    snapshotPath: null,
  };

  if (!row || !ai) return report;

  report.legacyShape = isLegacy(ai);
  const plan = planAiBlock(ai);
  report.settings = {
    enabled: plan.next.enabled as boolean,
    cardExtractModel: plan.next.cardExtractModel as string,
    requestsPerDay: plan.requestsPerDay,
    blockedByZeroBudget: plan.blockedByZeroBudget,
  };

  if (ai.apiKey !== undefined && ai.apiKey !== null) {
    report.problems.push(
      'system_settings.ai.apiKey still holds a pre-E4.2 ciphertext block: run `npm run vault:migrate-ai-key -- --apply` first.',
    );
  }
  if (!keyConfigured && plan.next.enabled === true) {
    report.problems.push(
      `AI is enabled but no deployment key is stored at credential ${VAULT_AI_CREDENTIAL_PURPOSE}/${VAULT_AI_CREDENTIAL_NAME}: store one at /admin/settings/ai first.`,
    );
  }

  const modelId = plan.next.cardExtractModel as string;
  const existing = await prisma.aiModel.findUnique({
    where: { provider_modelId: { provider: AI_PROVIDER_ID, modelId } },
  });
  report.model = {
    id: modelId,
    action: existing ? 'exists' : apply ? 'created' : 'would-create',
    enabled: existing ? existing.enabled : true,
  };

  const needsSettingsWrite = report.legacyShape;
  report.outcome = needsSettingsWrite ? (apply ? 'migrated' : 'would-migrate') : 'already-migrated';

  if (!apply) return report;
  if (report.problems.length > 0) {
    report.outcome = needsSettingsWrite ? 'would-migrate' : 'already-migrated';
    report.model.action = existing ? 'exists' : 'would-create';
    return report;
  }

  // 1. The catalogue row (never re-enabled when it exists), before the settings point at it.
  if (!existing) {
    const capabilities = classifyOpenAiModel(modelId) ?? {
      capabilities: ['responses', 'structured_output', 'vision_input', 'streaming'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
    };
    await prisma.aiModel.create({
      data: {
        provider: AI_PROVIDER_ID,
        modelId,
        capabilities,
        capabilitySource: 'admin_override',
        enabled: true,
      },
    });
  }

  if (!needsSettingsWrite) return report;

  // 2. The snapshot of the old block FIRST (no key material: a ciphertext block refused above).
  const snapshotPath = options.snapshotPath ?? 'ai-platform-legacy.json';
  if (existsSync(snapshotPath)) {
    throw new Error(`The snapshot ${snapshotPath} already exists; refusing to overwrite an earlier one.`);
  }
  writeFileSync(snapshotPath, JSON.stringify({ takenAt: new Date().toISOString(), ai }, null, 2), { flag: 'wx' });
  report.snapshotPath = snapshotPath;

  // 3. The settings, guarded on the row version so a concurrent admin save is detected.
  const value = row.value as Record<string, unknown>;
  const updated = await prisma.systemSettings.updateMany({
    where: { key: SETTINGS_KEY, version: row.version },
    data: { value: { ...value, ai: plan.next }, version: { increment: 1 } },
  });
  if (updated.count !== 1) {
    throw new Error('The settings row changed while migrating. The catalogue row is in place; rerun to finish.');
  }

  await prisma.auditEvent.create({
    data: {
      action: AI_PLATFORM_MIGRATION_AUDIT_ACTION,
      targetType: 'system_settings',
      targetId: SETTINGS_KEY,
      // Counts and names only: no key, no card data.
      meta: { cardExtractModel: modelId, requestsPerDay: plan.requestsPerDay, enabled: plan.next.enabled },
    },
  });
  return report;
}

export function formatAiPlatformMigrationReport(report: AiPlatformMigrationReport): string[] {
  const lines = [
    `mode: ${report.apply ? 'APPLY' : 'dry run (pass --apply to change anything)'}`,
    `outcome: ${report.outcome}`,
    `legacy ai block: ${report.legacyShape ? 'present (will be rewritten)' : 'not present'}`,
    `settings: enabled=${report.settings.enabled} cardExtractModel=${report.settings.cardExtractModel} perUserRequestsPerDay=${report.settings.requestsPerDay ?? 'unlimited'}`,
    `model: ${report.model.id ?? '-'} -> ${report.model.action}${report.model.action === 'exists' ? ` (enabled=${report.model.enabled})` : ''}`,
    `deployment key ${VAULT_AI_CREDENTIAL_PURPOSE}/${VAULT_AI_CREDENTIAL_NAME}: ${report.keyConfigured ? 'present' : 'absent'}`,
  ];
  if (report.settings.blockedByZeroBudget) {
    lines.push('note: maxCallsPerUserPerDay was 0 (scanning blocked); AI is switched OFF instead.');
  }
  if (report.snapshotPath) lines.push(`snapshot: ${report.snapshotPath}`);
  for (const problem of report.problems) lines.push(`PROBLEM: ${problem}`);
  return lines;
}
