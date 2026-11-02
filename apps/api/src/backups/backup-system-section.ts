/**
 * The `system/` section of a system backup: the deployment's configuration.
 *
 * ```
 * system/users.json         users and their role names
 * system/allowlist.json     the email allowlist
 * system/secret-types.json  custom secret types (system types are seeded)
 * system/settings.json      system settings, through the redacted projection
 * ```
 *
 * Redaction is by construction: every mapper below builds its output from an
 * explicit list of fields, never by spreading a row, so a column added to a
 * model later (or a row that carries more than its `select` asked for) cannot
 * leak into the archive. Never included: refresh tokens, personal access
 * tokens, device codes, provider identities, sessions, the AI API key or any
 * other encrypted credential, the backup password, the audit log.
 */

/**
 * The role names an archive lists for a user: the system roles in `user_roles`
 * plus the role of the user's active membership of the default organization
 * (the platform keeps `contributor` / `viewer` on the membership, not in
 * `user_roles`). `org_admin` is left out because it is implied by `admin`
 * (platform migration 0024 gave every admin an `org_admin` membership) and the
 * archive format has never carried it.
 */
function effectiveRoleNames(
  userRoles: Array<{ role: { name: string } | null }> | undefined,
  memberships: Array<{ role: { name: string } | null }> | undefined,
): string[] {
  const names = new Set<string>();
  for (const ur of userRoles ?? []) if (ur.role) names.add(ur.role.name);
  for (const m of memberships ?? []) {
    if (m.role && m.role.name !== 'org_admin') names.add(m.role.name);
  }
  return [...names];
}

export const SYSTEM_SECTION_DIR = 'system';

export const SYSTEM_SECTION_FILES = {
  users: `${SYSTEM_SECTION_DIR}/users.json`,
  allowlist: `${SYSTEM_SECTION_DIR}/allowlist.json`,
  secretTypes: `${SYSTEM_SECTION_DIR}/secret-types.json`,
  settings: `${SYSTEM_SECTION_DIR}/settings.json`,
} as const;

// ---------------------------------------------------------------------------
// Prisma `select`s: only the columns the section needs are ever read.
// ---------------------------------------------------------------------------

export const SYSTEM_USERS_SELECT = {
  id: true,
  email: true,
  displayName: true,
  isActive: true,
  createdAt: true,
  userRoles: { select: { role: { select: { name: true } } } },
  // Org roles (contributor, viewer) live on the default-org membership.
  memberships: {
    where: { status: 'active', org: { isDefault: true } },
    select: { role: { select: { name: true } } },
  },
} as const;

export const SYSTEM_ALLOWLIST_SELECT = {
  email: true,
  notes: true,
  addedAt: true,
  claimedAt: true,
  claimedById: true,
  addedBy: { select: { email: true } },
} as const;

export const SYSTEM_SECRET_TYPES_SELECT = {
  id: true,
  name: true,
  description: true,
  icon: true,
  fields: true,
  allowAttachments: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { email: true } },
} as const;

// ---------------------------------------------------------------------------
// Input row shapes (declared locally so the mappers are unit testable)
// ---------------------------------------------------------------------------

export interface SystemUserRow {
  id: string;
  email: string;
  displayName: string | null;
  isActive: boolean;
  createdAt: Date;
  lastLoginAt?: Date | null;
  userRoles?: Array<{ role: { name: string } | null }>;
  memberships?: Array<{ role: { name: string } | null }>;
}

export interface SystemAllowlistRow {
  email: string;
  notes: string | null;
  addedAt: Date;
  claimedAt: Date | null;
  claimedById: string | null;
  addedBy?: { email: string } | null;
}

export interface SystemSecretTypeRow {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  fields: unknown;
  allowAttachments: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: { email: string } | null;
}

/** The masked projection `SystemSettingsService.getSettings()` returns. */
export interface SystemSettingsProjectionInput {
  ui: unknown;
  features: unknown;
  ai: {
    enabled: boolean;
    provider: string;
    model: string;
    maxCallsPerUserPerDay: number;
    apiKeyConfigured: boolean;
    [extra: string]: unknown;
  } | null;
  updatedAt: Date | string | null;
  updatedBy: { id: string; email: string } | null;
  version: number;
}

// ---------------------------------------------------------------------------
// Output shapes (what the json files contain)
// ---------------------------------------------------------------------------

export interface SystemUserEntry {
  id: string;
  email: string;
  displayName: string | null;
  isActive: boolean;
  roles: string[];
  createdAt: string;
  lastLoginAt?: string;
}

export interface SystemAllowlistEntry {
  email: string;
  notes: string | null;
  addedBy: string | null;
  status: 'pending' | 'claimed';
  addedAt: string;
  claimedAt: string | null;
}

export interface SystemSecretTypeEntry {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  fields: unknown;
  allowAttachments: boolean;
  owner: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SystemSettingsEntry {
  ui: unknown;
  features: unknown;
  /** The AI block with the key reduced to `apiKeyConfigured`. */
  ai: {
    enabled: boolean;
    provider: string;
    model: string;
    maxCallsPerUserPerDay: number;
    apiKeyConfigured: boolean;
  } | null;
  updatedAt: string | null;
  updatedBy: string | null;
  version: number;
}

export interface SystemSection {
  users: SystemUserEntry[];
  allowlist: SystemAllowlistEntry[];
  secretTypes: SystemSecretTypeEntry[];
  settings: SystemSettingsEntry;
}

function iso(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  return date instanceof Date ? date.toISOString() : new Date(date).toISOString();
}

export function toSystemUsers(rows: SystemUserRow[]): SystemUserEntry[] {
  return rows.map((row) => {
    const entry: SystemUserEntry = {
      id: row.id,
      email: row.email,
      displayName: row.displayName ?? null,
      isActive: row.isActive,
      roles: effectiveRoleNames(row.userRoles, row.memberships).sort(),
      createdAt: row.createdAt.toISOString(),
    };
    if (row.lastLoginAt) {
      entry.lastLoginAt = row.lastLoginAt.toISOString();
    }
    return entry;
  });
}

export function toSystemAllowlist(rows: SystemAllowlistRow[]): SystemAllowlistEntry[] {
  return rows.map((row) => ({
    email: row.email,
    notes: row.notes ?? null,
    addedBy: row.addedBy?.email ?? null,
    status: row.claimedById || row.claimedAt ? 'claimed' : 'pending',
    addedAt: row.addedAt.toISOString(),
    claimedAt: iso(row.claimedAt),
  }));
}

export function toSystemSecretTypes(rows: SystemSecretTypeRow[]): SystemSecretTypeEntry[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    icon: row.icon ?? null,
    fields: row.fields,
    allowAttachments: row.allowAttachments,
    owner: row.createdBy?.email ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/**
 * System settings from the masked projection, with the AI key reduced further
 * to `apiKeyConfigured` (no last four characters, no key timestamps).
 * `ui` and `features` are copied through JSON so only plain data remains.
 */
export function toSystemSettings(projection: SystemSettingsProjectionInput): SystemSettingsEntry {
  const ai = projection.ai;
  return {
    ui: JSON.parse(JSON.stringify(projection.ui ?? {})),
    features: JSON.parse(JSON.stringify(projection.features ?? {})),
    ai: ai
      ? {
          enabled: ai.enabled,
          provider: ai.provider,
          model: ai.model,
          maxCallsPerUserPerDay: ai.maxCallsPerUserPerDay,
          apiKeyConfigured: ai.apiKeyConfigured === true,
        }
      : null,
    updatedAt: iso(projection.updatedAt),
    updatedBy: projection.updatedBy?.email ?? null,
    version: projection.version,
  };
}
