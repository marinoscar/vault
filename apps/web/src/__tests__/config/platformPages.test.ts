/**
 * The packaged pages of the platform exports, user-data and onboarding slices (issue #91, E9.3): each
 * descriptor is exactly one registry card and one route in `App.tsx`, gated on the string its API
 * controller enforces, and both Danger Zone groups stay last.
 */
import { describe, expect, it } from 'vitest';
import { dataExportSettingsPage } from '@marinoscar/platform-web/exports/ui';
import { gettingStartedSettingsPage, setupGuideSettingsPage } from '@marinoscar/platform-web/onboarding/ui';
import { dangerZoneSettingsPage, factoryResetSettingsPage } from '@marinoscar/platform-web/user-data/ui';
import { dangerZoneLastViolations } from '@marinoscar/platform-web/user-data/headless';

import { ADMIN_SECTIONS } from '../../config/adminSections';
import { USER_SETTINGS_SECTIONS } from '../../config/userSettingsSections';
import appSource from '../../App.tsx?raw';

const cards = (sections: typeof ADMIN_SECTIONS) => sections.flatMap((section) => section.cards);

/** `App.tsx`: the permission a route's `RequirePermission` names, or null for an ungated route. */
function routeGate(path: string): string | null | undefined {
  const match = new RegExp(`<Route\\s+path="${path.replace(/\//g, '\\/')}"([\\s\\S]*?)/>`).exec(appSource);
  if (!match) return undefined;
  return /^\s*element=\{<RequirePermission\s+permission="([^"]+)"/.exec(match[1])?.[1] ?? null;
}

describe.each([
  ['Download your data', dataExportSettingsPage, USER_SETTINGS_SECTIONS, undefined],
  ['Getting started', gettingStartedSettingsPage, USER_SETTINGS_SECTIONS, undefined],
  ['Delete my data', dangerZoneSettingsPage, USER_SETTINGS_SECTIONS, undefined],
  ['Setup guide', setupGuideSettingsPage, ADMIN_SECTIONS, 'system_settings:read'],
  ['Factory reset', factoryResetSettingsPage, ADMIN_SECTIONS, 'system:factory_reset'],
] as const)('%s', (title, page, sections, permission) => {
  const registered = cards(sections as typeof ADMIN_SECTIONS).filter((card) => card.path === page.card.path);

  it('is exactly one card of its registry, with the descriptor\'s title and the controller\'s permission', () => {
    expect(registered).toHaveLength(1);
    expect(registered[0].title).toBe(title);
    expect(registered[0].permission).toBe(permission);
    expect(registered[0].Icon).toBe(page.Icon);
  });

  it('is exactly one route in App.tsx, gated like its card', () => {
    expect(routeGate(page.card.path!)).toBe(permission ?? null);
    expect([...appSource.matchAll(new RegExp(`path="${page.card.path}"`, 'g'))]).toHaveLength(1);
  });

  it('carries no AI feature gate: it stays reachable while AI is off', () => {
    expect(registered[0].feature).toBeUndefined();
  });
});

describe('the Danger Zone groups', () => {
  it('are the last group of both registries, alone in it', () => {
    expect(dangerZoneLastViolations(USER_SETTINGS_SECTIONS, dangerZoneSettingsPage.card.path!)).toEqual([]);
    expect(dangerZoneLastViolations(ADMIN_SECTIONS, factoryResetSettingsPage.card.path!)).toEqual([]);
    expect(USER_SETTINGS_SECTIONS[USER_SETTINGS_SECTIONS.length - 1].cards).toHaveLength(1);
    expect(ADMIN_SECTIONS[ADMIN_SECTIONS.length - 1].cards).toHaveLength(1);
  });
});

describe('the onboarding provider', () => {
  it('wraps the shell once, with the welcome dialog inside it', async () => {
    const layout = (await import('../../components/common/Layout.tsx?raw')).default;
    expect(layout).toContain('<OnboardingProvider appName={PRODUCT_NAME}>');
    expect(layout.match(/<WelcomeDialog \/>/g)).toHaveLength(1);
  });
});
