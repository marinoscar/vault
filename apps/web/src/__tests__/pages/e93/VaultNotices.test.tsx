/**
 * Vault's notices on the packaged export, Danger Zone and factory reset pages (issue #91, E9.3), and the two
 * onboarding page wrappers that refresh the checklist when they mount.
 */
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '../../utils/test-utils';
import { mockAdminUser, mockUser } from '../../utils/test-utils';
import { VaultExportNotice } from '../../../components/exports/VaultExportNotice';
import { FactoryResetNotice, UserDangerZoneNotice } from '../../../components/user-data/DangerZoneNotices';

const contributor = { ...mockUser, permissions: [...mockUser.permissions, 'secrets:read'] };
const admin = { ...mockAdminUser, permissions: [...mockAdminUser.permissions, 'secrets:read'] };

describe('VaultExportNotice', () => {
  it('says secret values are not in the downloads and links to My backups for a holder of secrets:read', () => {
    render(<VaultExportNotice />, { wrapperOptions: { user: contributor } });
    expect(screen.getByText('Secret values are not in these downloads')).toBeInTheDocument();
    expect(screen.getByText(/Passwords, API keys, card numbers and notes are never included/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My backups' })).toHaveAttribute('href', '/settings/backups');
  });

  it('offers no link to a page the viewer cannot open', () => {
    render(<VaultExportNotice />, { wrapperOptions: { user: mockUser } });
    expect(screen.getByText('Secret values are not in these downloads')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'My backups' })).not.toBeInTheDocument();
  });
});

describe('UserDangerZoneNotice', () => {
  it('warns that deletion is permanent and that deleting everything also deletes saved backups', () => {
    render(<UserDangerZoneNotice />, { wrapperOptions: { user: contributor } });
    expect(screen.getByText('Deleting secrets cannot be undone')).toBeInTheDocument();
    expect(screen.getByText(/also deletes your saved\s+backups/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My backups' })).toHaveAttribute('href', '/settings/backups');
  });
});

describe('FactoryResetNotice', () => {
  it('says the reset deletes Vault\'s own backups and links to the Console backups page for an administrator', () => {
    render(<FactoryResetNotice />, { wrapperOptions: { user: admin } });
    expect(screen.getByText(/also deletes Vault.s own backups|deletes Vault's own backups/i)).toBeInTheDocument();
    expect(screen.getByText(/The backup schedule and its password stay/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Backups' })).toHaveAttribute('href', '/admin/settings/backups');
  });
});

vi.mock('@marinoscar/platform-web/onboarding/headless', async (importOriginal) => {
  const original = await importOriginal<typeof import('@marinoscar/platform-web/onboarding/headless')>();
  return { ...original, useOnboarding: () => ({ ...original.ONBOARDING_INERT, refresh: refreshSpy }) };
});
vi.mock('@marinoscar/platform-web/onboarding/ui', () => ({
  GettingStartedPage: () => <div>getting-started-page</div>,
  SetupGuidePage: () => <div>setup-guide-page</div>,
}));
const refreshSpy = vi.fn().mockResolvedValue(undefined);

describe('onboarding page wrappers', () => {
  it.each([
    ['GettingStartedRoute', () => import('../../../components/onboarding/GettingStartedRoute'), 'getting-started-page'],
    ['SetupGuideRoute', () => import('../../../components/onboarding/SetupGuideRoute'), 'setup-guide-page'],
  ])('%s refreshes the checklist when it mounts and renders the packaged page', async (_name, load, text) => {
    refreshSpy.mockClear();
    const { default: Route } = await load();
    render(<Route />, { wrapperOptions: { user: admin } });
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });
});
