// Vault's onboarding steps and facts (issue #91, E9.3): pure evaluation of each step over sample facts, the
// registries as the app fills them, and the rules that make the checklist honest (a role that cannot act on a
// step is never shown it, the AI step is absent while AI is unusable, nothing is stored).

import '../../src/app-registrations/registrations';

import { permissionRegistry } from '@marinoscar/platform-api/core';
import { onboardingFactRegistry, onboardingStepRegistry, ONBOARDING_STEP_IDS } from '@marinoscar/platform-api/onboarding';

import {
  ADMIN_VAULT_BACKUPS_STEP,
  USER_FIRST_BACKUP_STEP,
  USER_FIRST_SECRET_STEP,
  USER_INSTALL_CLI_STEP,
  USER_SCAN_CARD_STEP,
  VAULT_ONBOARDING_STEP_DEFS,
} from '../../src/platform/onboarding/onboarding.steps';
import { VAULT_ONBOARDING_FACTS, VAULT_ONBOARDING_FACT_DEFS } from '../../src/platform/onboarding/onboarding.facts';

const F = VAULT_ONBOARDING_FACTS;

describe('Vault onboarding steps', () => {
  it('registers the issue\'s five steps beside the platform\'s, with permanent ids', () => {
    expect(VAULT_ONBOARDING_STEP_DEFS.map((step) => step.id)).toEqual([
      'admin.vault_backups',
      'user.first_secret',
      'user.scan_card',
      'user.first_backup',
      'user.install_cli',
    ]);
    const registered = onboardingStepRegistry.list().map((step) => step.id);
    for (const step of VAULT_ONBOARDING_STEP_DEFS) expect(registered).toContain(step.id);
    // "Configure storage (admin)" is the platform's step, kept as it is.
    expect(registered).toContain(ONBOARDING_STEP_IDS.STORAGE);
    expect(onboardingStepRegistry.get(ONBOARDING_STEP_IDS.STORAGE)).toMatchObject({ permission: 'storage_config:read', href: '/admin/settings/storage' });
  });

  it('names a fact registered for every fact a step reads', () => {
    const facts = new Set(onboardingFactRegistry.list().map((fact) => fact.id));
    for (const def of VAULT_ONBOARDING_FACT_DEFS) expect(facts.has(def.id)).toBe(true);
    for (const step of VAULT_ONBOARDING_STEP_DEFS) for (const id of step.facts) expect(facts.has(id)).toBe(true);
  });

  it('only names permissions the app registers, and never lets a role without the permission see a step', () => {
    for (const step of VAULT_ONBOARDING_STEP_DEFS) {
      if (step.permission) expect(permissionRegistry.has(step.permission)).toBe(true);
    }
    // A Viewer has no `secrets:write`: it is never asked to create a secret or scan a card.
    expect(USER_FIRST_SECRET_STEP.permission).toBe('secrets:write');
    expect(USER_SCAN_CARD_STEP.permission).toBe('secrets:write');
    expect(USER_FIRST_BACKUP_STEP.permission).toBe('secrets:read');
  });

  it('keeps required steps unskippable and registers none as required for a user', () => {
    for (const step of VAULT_ONBOARDING_STEP_DEFS) {
      if (step.tier === 'required') expect(step.skippable).toBe(false);
    }
  });

  it('drops the database-backup step while the slice\'s permission is not registered, and keeps the rest', () => {
    const dbBackupMounted = permissionRegistry.has('db_backup:read');
    expect(onboardingStepRegistry.has(ONBOARDING_STEP_IDS.BACKUP)).toBe(dbBackupMounted);
    // The identity, storage, AI and push steps do not depend on it.
    for (const id of [ONBOARDING_STEP_IDS.STORAGE, ONBOARDING_STEP_IDS.EMAIL, ONBOARDING_STEP_IDS.ACCESS, ONBOARDING_STEP_IDS.AI, ONBOARDING_STEP_IDS.PUSH]) {
      expect(onboardingStepRegistry.has(id)).toBe(true);
    }
  });

  describe('user.first_secret', () => {
    it.each([
      [0, 'todo'],
      [1, 'done'],
      [40, 'done'],
    ])('with %i secrets is %s', (count, status) => {
      expect(USER_FIRST_SECRET_STEP.evaluate?.({ [F.OWN_SECRET_COUNT]: count })).toEqual({ status });
    });
  });

  describe('user.scan_card', () => {
    it('is absent while card scanning is unusable (AI off, no key, provider off)', () => {
      expect(USER_SCAN_CARD_STEP.applies?.({ [F.CARD_SCAN]: { available: false, count: 0 } })).toBe(false);
      expect(USER_SCAN_CARD_STEP.applies?.({ [F.CARD_SCAN]: { available: true, count: 0 } })).toBe(true);
    });

    it('is done once a scan has succeeded', () => {
      expect(USER_SCAN_CARD_STEP.evaluate?.({ [F.CARD_SCAN]: { available: true, count: 0 } })).toEqual({ status: 'todo' });
      expect(USER_SCAN_CARD_STEP.evaluate?.({ [F.CARD_SCAN]: { available: true, count: 3 } })).toEqual({ status: 'done' });
    });

    it('links to the import page', () => {
      expect(USER_SCAN_CARD_STEP.href).toBe('/cards/import');
    });
  });

  describe('user.first_backup', () => {
    it('is done after one successful My backups run', () => {
      expect(USER_FIRST_BACKUP_STEP.evaluate?.({ [F.OWN_BACKUP_COUNT]: 0 })).toEqual({ status: 'todo' });
      expect(USER_FIRST_BACKUP_STEP.evaluate?.({ [F.OWN_BACKUP_COUNT]: 1 })).toEqual({ status: 'done' });
    });
  });

  describe('user.install_cli', () => {
    it('is done once the user holds an access token (a CLI login creates one)', () => {
      expect(USER_INSTALL_CLI_STEP.evaluate?.({ [F.OWN_TOKEN_COUNT]: 0 })).toEqual({ status: 'todo' });
      expect(USER_INSTALL_CLI_STEP.evaluate?.({ [F.OWN_TOKEN_COUNT]: 2 })).toEqual({ status: 'done' });
    });

    it('needs no permission: the access tokens page is ownership-scoped', () => {
      expect(USER_INSTALL_CLI_STEP.permission).toBeUndefined();
      expect(USER_INSTALL_CLI_STEP.description).toContain('`vault`');
    });
  });

  describe('admin.vault_backups', () => {
    it('is done only with the schedule on AND a password stored, and says which half is missing', () => {
      const evaluate = (enabled: boolean, passwordConfigured: boolean) =>
        ADMIN_VAULT_BACKUPS_STEP.evaluate?.({ [F.BACKUP_SCHEDULE]: { enabled, passwordConfigured } });
      expect(evaluate(true, true)).toEqual({ status: 'done' });
      expect(evaluate(true, false)).toMatchObject({ status: 'todo', detail: expect.stringContaining('no archive password') });
      expect(evaluate(false, true)).toMatchObject({ status: 'todo', detail: expect.stringContaining('off') });
    });

    it('is gated by the string the schedule route enforces', () => {
      expect(ADMIN_VAULT_BACKUPS_STEP.permission).toBe('system_settings:read');
      expect(ADMIN_VAULT_BACKUPS_STEP.audience).toBe('admin');
    });
  });
});
