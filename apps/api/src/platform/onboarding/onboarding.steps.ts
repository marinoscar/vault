import type { OnboardingFacts, OnboardingStepDef } from '@marinoscar/platform-api/onboarding';

import {
  VAULT_ONBOARDING_FACTS,
  type VaultBackupScheduleFact,
  type VaultCardScanFact,
} from './onboarding.facts';

// =============================================================================
// This app's onboarding steps (issue #91, E9.3, epic #64)
// =============================================================================
//
// The platform's built-ins (`admin.storage`, `admin.email`, `admin.access`, `admin.ai`, `admin.push`,
// `admin.backup` for the database backups, `user.profile`, `user.notifications`) are registered by
// `onboarding.manifest.ts`. These are Vault's:
//
//   admin.vault_backups   recommended  schedule the encrypted secret backups with a password
//   user.first_secret     recommended  create a first secret
//   user.scan_card        optional     scan a card with the vision model (only while AI is usable)
//   user.first_backup     recommended  save a first password-protected backup (My backups)
//   user.install_cli      optional     install the `vault` CLI and sign in
//
// STEP IDS ARE PERMANENT: a user's `onboarding.skipped` stores them. A step's `permission` is the
// exact string the page it links to enforces, or the step is omitted for a role that cannot act on it
// (a Viewer holds no `secrets:write`, so it is never asked to create a secret).
//
// A step never issues a query: every `evaluate` is a pure function of the facts it names
// (`onboarding.facts.ts`). Every status is derived on read and nothing here is stored.
//
// ORDER. The platform's steps own 10..70 (admin) and 10..20 (user). Vault's sit between and ahead:
// the backup step at 65 (after the database backups, 60), the user steps at 1..5 ahead of the
// profile.
// =============================================================================

function fact<T>(facts: OnboardingFacts, id: string): T {
  return facts[id] as T;
}

export const ADMIN_VAULT_BACKUPS_STEP: OnboardingStepDef = {
  id: 'admin.vault_backups',
  audience: 'admin',
  tier: 'recommended',
  order: 65,
  title: 'Schedule encrypted secret backups',
  description:
    'Choose a schedule and an archive password, and Vault saves a password-protected backup of everyone\'s secrets to storage. The password is stored encrypted and is not recoverable.',
  actionLabel: 'Configure backups',
  href: '/admin/settings/backups',
  // GET /api/admin/backups/schedule (backups.controller.ts); saving needs system_settings:write.
  permission: 'system_settings:read',
  skippable: true,
  facts: [VAULT_ONBOARDING_FACTS.BACKUP_SCHEDULE],
  evaluate: (facts) => {
    const schedule = fact<VaultBackupScheduleFact>(facts, VAULT_ONBOARDING_FACTS.BACKUP_SCHEDULE);
    if (schedule.enabled && schedule.passwordConfigured) return { status: 'done' };
    return {
      status: 'todo',
      detail: schedule.enabled
        ? 'The schedule is on, but no archive password is stored yet.'
        : 'The schedule is off. Turn it on and set the archive password.',
    };
  },
};

export const USER_FIRST_SECRET_STEP: OnboardingStepDef = {
  id: 'user.first_secret',
  audience: 'user',
  tier: 'recommended',
  order: 1,
  title: 'Create your first secret',
  description: 'Store a login, an API key, a payment card or a note. It is encrypted before it is saved.',
  actionLabel: 'New secret',
  href: '/secrets/new',
  // POST /api/secrets (secrets.controller.ts).
  permission: 'secrets:write',
  skippable: true,
  facts: [VAULT_ONBOARDING_FACTS.OWN_SECRET_COUNT],
  funnelSql: 'EXISTS (SELECT 1 FROM secrets s WHERE s.created_by_id = c.id)',
  evaluate: (facts) => ({
    status: fact<number>(facts, VAULT_ONBOARDING_FACTS.OWN_SECRET_COUNT) > 0 ? 'done' : 'todo',
  }),
};

export const USER_SCAN_CARD_STEP: OnboardingStepDef = {
  id: 'user.scan_card',
  audience: 'user',
  tier: 'optional',
  order: 2,
  title: 'Scan a card',
  description:
    'Photograph a payment card and Vault fills in the form for you to review. The security code is never read or saved.',
  actionLabel: 'Scan a card',
  href: '/cards/import',
  // POST /api/secrets/cards/extract (card-extract.controller.ts); also needs `ai:use`.
  permission: 'secrets:write',
  skippable: true,
  facts: [VAULT_ONBOARDING_FACTS.CARD_SCAN],
  // ABSENT, not blocked, while scanning is unusable: AI off, no deployment key or the provider off.
  applies: (facts) => fact<VaultCardScanFact>(facts, VAULT_ONBOARDING_FACTS.CARD_SCAN).available,
  evaluate: (facts) => ({
    status: fact<VaultCardScanFact>(facts, VAULT_ONBOARDING_FACTS.CARD_SCAN).count > 0 ? 'done' : 'todo',
  }),
};

export const USER_FIRST_BACKUP_STEP: OnboardingStepDef = {
  id: 'user.first_backup',
  audience: 'user',
  tier: 'recommended',
  order: 3,
  title: 'Make your first backup',
  description:
    'Pick a password and save an encrypted copy of your secrets. The password is never stored: keep it somewhere safe.',
  actionLabel: 'Open My backups',
  href: '/settings/backups',
  // my-backups.controller.ts (every route).
  permission: 'secrets:read',
  skippable: true,
  facts: [VAULT_ONBOARDING_FACTS.OWN_BACKUP_COUNT],
  funnelSql: "EXISTS (SELECT 1 FROM backup_runs b WHERE b.owner_id = c.id AND b.scope = 'user' AND b.status = 'succeeded')",
  evaluate: (facts) => ({
    status: fact<number>(facts, VAULT_ONBOARDING_FACTS.OWN_BACKUP_COUNT) > 0 ? 'done' : 'todo',
  }),
};

export const USER_INSTALL_CLI_STEP: OnboardingStepDef = {
  id: 'user.install_cli',
  audience: 'user',
  tier: 'optional',
  order: 4,
  title: 'Install the command-line tool',
  description:
    'Install `vault` (see the CLI README), run `vault login` to sign in from your terminal, and use it in scripts or for scheduled backups. This step completes once you have an access token, such as the one a CLI login creates.',
  actionLabel: 'Open access tokens',
  href: '/settings/tokens',
  // The packaged access-tokens page is a bare `@Auth()` and ownership-scoped: no permission.
  skippable: true,
  facts: [VAULT_ONBOARDING_FACTS.OWN_TOKEN_COUNT],
  funnelSql: 'EXISTS (SELECT 1 FROM personal_access_tokens t WHERE t.user_id = c.id AND t.revoked_at IS NULL)',
  evaluate: (facts) => ({
    status: fact<number>(facts, VAULT_ONBOARDING_FACTS.OWN_TOKEN_COUNT) > 0 ? 'done' : 'todo',
  }),
};

/** The steps Vault registers beside the platform's. */
export const VAULT_ONBOARDING_STEP_DEFS: readonly OnboardingStepDef[] = [
  ADMIN_VAULT_BACKUPS_STEP,
  USER_FIRST_SECRET_STEP,
  USER_SCAN_CARD_STEP,
  USER_FIRST_BACKUP_STEP,
  USER_INSTALL_CLI_STEP,
];
