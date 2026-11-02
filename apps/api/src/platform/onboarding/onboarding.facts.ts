import type { OnboardingFactDef } from '@marinoscar/platform-api/onboarding';
import { AiConfigService } from '@marinoscar/platform-api/ai';

import { CARD_EXTRACT_FEATURE, isCardScanAvailable } from '@marinoscar/vault-api/ai';
import { PrismaService } from '../../prisma/prisma.service';

// =============================================================================
// This app's onboarding facts (issue #91, E9.3, epic #64)
// =============================================================================
//
// A fact is the ONLY read an onboarding step may depend on: the engine resolves each one at most once
// per request, in parallel, and a step's `evaluate` receives plain values. A fact that rejects omits
// the steps that name it (one logged warning); it never fails the response. Ids are `vault.<name>`.
//
// Every fact is a COUNT or a boolean: never a name, a value, a key or a row. Nothing here reads a
// secret's data, and the card-scan evidence is a usage COUNT (the scan itself persists nothing).
// =============================================================================

export const VAULT_ONBOARDING_FACTS = {
  /** `number`: secrets the caller created. */
  OWN_SECRET_COUNT: 'vault.ownSecretCount',
  /** {@link VaultCardScanFact}: whether scanning is available and how many scans the caller has made. */
  CARD_SCAN: 'vault.cardScan',
  /** `number`: successful "My backups" runs of the caller. */
  OWN_BACKUP_COUNT: 'vault.ownBackupCount',
  /** `number`: access tokens (including the CLI's device logins) of the caller that are not revoked. */
  OWN_TOKEN_COUNT: 'vault.ownTokenCount',
  /** {@link VaultBackupScheduleFact}: the scheduled-backup configuration. */
  BACKUP_SCHEDULE: 'vault.backupSchedule',
} as const;

export interface VaultCardScanFact {
  /** Card scanning is usable by this caller (AI on, provider on, deployment key stored). */
  available: boolean;
  /** Successful `card_extract` calls the caller has made. */
  count: number;
}

export interface VaultBackupScheduleFact {
  /** The scheduled backup is switched on. */
  enabled: boolean;
  /** An archive password is stored (the value is never read here). */
  passwordConfigured: boolean;
}

export const OWN_SECRET_COUNT_FACT: OnboardingFactDef<number> = {
  id: VAULT_ONBOARDING_FACTS.OWN_SECRET_COUNT,
  resolve: (ctx) => ctx.get(PrismaService).secret.count({ where: { createdById: ctx.caller.id } }),
};

export const CARD_SCAN_FACT: OnboardingFactDef<VaultCardScanFact> = {
  id: VAULT_ONBOARDING_FACTS.CARD_SCAN,
  resolve: async (ctx) => {
    const orgId = ctx.caller.activeOrgId;
    if (!orgId) return { available: false, count: 0 };
    const available = isCardScanAvailable(await ctx.get(AiConfigService).describePublic(orgId));
    // `ai_usage_events` forces row-level security on `org_id`: read it inside the caller's organization.
    const count = await ctx
      .get(PrismaService)
      .forOrg(orgId, { userId: ctx.caller.id })
      .aiUsageEvent.count({
        where: { userId: ctx.caller.id, feature: CARD_EXTRACT_FEATURE, status: 'succeeded' },
      });
    return { available, count };
  },
};

export const OWN_BACKUP_COUNT_FACT: OnboardingFactDef<number> = {
  id: VAULT_ONBOARDING_FACTS.OWN_BACKUP_COUNT,
  resolve: (ctx) =>
    ctx.get(PrismaService).backupRun.count({ where: { scope: 'user', ownerId: ctx.caller.id, status: 'succeeded' } }),
};

export const OWN_TOKEN_COUNT_FACT: OnboardingFactDef<number> = {
  id: VAULT_ONBOARDING_FACTS.OWN_TOKEN_COUNT,
  resolve: (ctx) => ctx.get(PrismaService).personalAccessToken.count({ where: { userId: ctx.caller.id, revokedAt: null } }),
};

export const BACKUP_SCHEDULE_FACT: OnboardingFactDef<VaultBackupScheduleFact> = {
  id: VAULT_ONBOARDING_FACTS.BACKUP_SCHEDULE,
  resolve: async (ctx) => {
    const row = await ctx
      .get(PrismaService)
      .backupSchedule.findUnique({ where: { id: 'default' }, select: { enabled: true, passwordEncrypted: true } });
    return { enabled: row?.enabled === true, passwordConfigured: Boolean(row?.passwordEncrypted) };
  },
};

/** Every fact the Vault steps need. */
export const VAULT_ONBOARDING_FACT_DEFS: readonly OnboardingFactDef[] = [
  OWN_SECRET_COUNT_FACT,
  CARD_SCAN_FACT,
  OWN_BACKUP_COUNT_FACT,
  OWN_TOKEN_COUNT_FACT,
  BACKUP_SCHEDULE_FACT,
];
