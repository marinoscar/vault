// =============================================================================
// Move stored settings onto the platform's layout (issue #79, E4.1)
// =============================================================================
//
// What the move is, and is not:
//
//   system_settings (`global`)  NOTHING MOVES. `ui`, `features` and `ai` keep
//     their keys and shapes (they are Vault's registered namespaces now), and the
//     platform carries every stored key it does not model, so the new namespaces
//     (`vaultCards`, `vaultBackups`) simply read as their defaults until an admin
//     saves one. They are deliberately NOT written here: materialising
//     `vaultCards.imageMaxBytes` would freeze today's `CARD_IMAGE_MAX_BYTES` and
//     make the variable stop working as the default. The report only says whether
//     a pre-E4.2 `ai.apiKey` block is still waiting for `vault:migrate-ai-key`
//     (the platform carries it forward untouched; it is never read or returned).
//
//   user_settings               `profile` moves from
//       { displayName?, useProviderImage, customImageUrl? }
//     to the platform's
//       { displayName?, imageSource: 'none' | 'provider', imageObjectId: null,
//         customImageUrl? }
//     `useProviderImage === false` becomes `none`, anything else `provider` (the
//     platform's own read-time rule, applied once so the rows stop depending on
//     it). `customImageUrl` is kept when it is a string and dropped when it is
//     null or empty. `theme` and every other key are left exactly as stored.
//
// Free of Nest and of the command line so the tests drive it with fakes.
// DRY RUN BY DEFAULT: a dry run reads and counts and writes nothing. IDEMPOTENT:
// a migrated profile has `imageSource` and no `useProviderImage`, which the scan
// skips, so a rerun reports zero changes. Each row is written with an optimistic
// `version` check; a row changed meanwhile is skipped and counted, not
// overwritten (rerun to pick it up).
// =============================================================================

export const SETTINGS_MIGRATION_AUDIT_ACTION = 'settings.migrated';

const SYSTEM_SETTINGS_KEY = 'global';
const PAGE_SIZE = 500;

type Json = Record<string, unknown>;

/** What a run did. Counts only; never a settings value. */
export interface SettingsMigrationReport {
  apply: boolean;
  /** `user_settings` rows read. */
  userRowsScanned: number;
  /** Rows whose profile is (apply: was) rewritten. */
  userRowsToMigrate: number;
  userRowsMigrated: number;
  /** Rows already in the platform layout. */
  userRowsCurrent: number;
  /** Rows whose value is not an object (left alone). */
  userRowsUnrecognised: number;
  /** Apply only: rows changed by someone else between the read and the write. */
  userRowsSkippedConcurrent: number;
  /** The `global` row still holds the pre-E4.2 `ai.apiKey` ciphertext block. */
  legacyAiKeyBlockPresent: boolean;
  /** The `global` row exists. */
  systemRowPresent: boolean;
}

export interface SettingsMigrationPrisma {
  systemSettings: {
    findUnique(args: { where: { key: string } }): Promise<{ value: unknown } | null>;
  };
  userSettings: {
    findMany(args: {
      take: number;
      orderBy: { id: 'asc' };
      cursor?: { id: string };
      skip?: number;
    }): Promise<Array<{ id: string; userId: string; value: unknown; version: number }>>;
    updateMany(args: {
      where: { id: string; version: number };
      data: { value: unknown; version: { increment: number } };
    }): Promise<{ count: number }>;
  };
  auditEvent: {
    create(args: {
      data: { action: string; targetType: string; targetId: string; meta: unknown };
    }): Promise<unknown>;
  };
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The migrated value of one stored user settings document, or null when it is
 * already in the platform layout (or is not a document at all).
 */
export function migrateUserSettingsValue(value: unknown): Json | null {
  if (!isObject(value) || !isObject(value.profile)) return null;
  const profile = value.profile;
  const hasLegacyFlag = Object.hasOwn(profile, 'useProviderImage');
  const hasSource = typeof profile.imageSource === 'string';
  if (!hasLegacyFlag && hasSource) return null;

  const { useProviderImage, customImageUrl, ...rest } = profile;
  const next: Json = { ...rest };
  if (!hasSource) next.imageSource = useProviderImage === false ? 'none' : 'provider';
  if (!Object.hasOwn(next, 'imageObjectId')) next.imageObjectId = null;
  if (typeof customImageUrl === 'string' && customImageUrl.length > 0) next.customImageUrl = customImageUrl;

  return { ...value, profile: next };
}

export async function migrateSettings(
  prisma: SettingsMigrationPrisma,
  options: { apply?: boolean } = {},
): Promise<SettingsMigrationReport> {
  const apply = options.apply === true;

  const systemRow = await prisma.systemSettings.findUnique({ where: { key: SYSTEM_SETTINGS_KEY } });
  const systemValue = isObject(systemRow?.value) ? systemRow.value : {};
  const ai = isObject(systemValue.ai) ? systemValue.ai : {};

  const report: SettingsMigrationReport = {
    apply,
    userRowsScanned: 0,
    userRowsToMigrate: 0,
    userRowsMigrated: 0,
    userRowsCurrent: 0,
    userRowsUnrecognised: 0,
    userRowsSkippedConcurrent: 0,
    legacyAiKeyBlockPresent: isObject(ai.apiKey),
    systemRowPresent: systemRow !== null,
  };

  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.userSettings.findMany({
      take: PAGE_SIZE,
      orderBy: { id: 'asc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) break;

    for (const row of page) {
      report.userRowsScanned += 1;
      if (!isObject(row.value) || !isObject(row.value.profile)) {
        report.userRowsUnrecognised += 1;
        continue;
      }
      const next = migrateUserSettingsValue(row.value);
      if (next === null) {
        report.userRowsCurrent += 1;
        continue;
      }
      report.userRowsToMigrate += 1;
      if (!apply) continue;

      const result = await prisma.userSettings.updateMany({
        where: { id: row.id, version: row.version },
        data: { value: next, version: { increment: 1 } },
      });
      if (result.count === 1) report.userRowsMigrated += 1;
      else report.userRowsSkippedConcurrent += 1;
    }

    cursor = page[page.length - 1].id;
    if (page.length < PAGE_SIZE) break;
  }

  if (apply && report.userRowsMigrated > 0) {
    // One audit row for the run: counts only.
    await prisma.auditEvent.create({
      data: {
        action: SETTINGS_MIGRATION_AUDIT_ACTION,
        targetType: 'user_settings',
        targetId: 'all',
        meta: {
          userRowsMigrated: report.userRowsMigrated,
          userRowsSkippedConcurrent: report.userRowsSkippedConcurrent,
        },
      },
    });
  }

  return report;
}

export function formatSettingsMigrationReport(report: SettingsMigrationReport): string[] {
  const lines = [
    report.apply ? 'settings migration: APPLY' : 'settings migration: DRY RUN (nothing is written; pass --apply)',
    `  system_settings.global: ${report.systemRowPresent ? 'present, nothing to move (ui, features, ai keep their keys)' : 'absent (the seed or the first read creates it)'}`,
    `  user_settings rows scanned:        ${report.userRowsScanned}`,
    `  already in the platform layout:    ${report.userRowsCurrent}`,
    report.apply
      ? `  migrated:                          ${report.userRowsMigrated}`
      : `  would migrate:                     ${report.userRowsToMigrate}`,
  ];
  if (report.userRowsUnrecognised > 0) lines.push(`  not a settings document (skipped): ${report.userRowsUnrecognised}`);
  if (report.userRowsSkippedConcurrent > 0) {
    lines.push(`  changed meanwhile (skipped):       ${report.userRowsSkippedConcurrent}  (rerun to pick them up)`);
  }
  if (report.legacyAiKeyBlockPresent) {
    lines.push(
      '  WARNING: system_settings.global still holds the pre-E4.2 ai.apiKey block.',
      '           Run `npm run vault:migrate-ai-key -- --apply` (docs/runbooks/ai-key-migration.md).',
    );
  }
  return lines;
}
