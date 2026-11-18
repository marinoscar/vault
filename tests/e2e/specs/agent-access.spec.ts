/**
 * Agent access journey (E14.9, #181): the person opens a login to agents and sees the "Agents"
 * chip, reads the Agent activity page, and an administrator saves the Agent access kill switch.
 * The network is mocked (`tests/support/mock-api.ts`); the API half of the epic's acceptance
 * scenario is `apps/api/test/agent/agent-access-acceptance.db.spec.ts` on real Postgres.
 */
import { expect, test } from '@playwright/test';
import { installMockApi, type MockAgentActivityItem } from '../../support/mock-api';
import { stabilizePage } from '../../support/stabilize';

test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
});

const ACTIVITY: MockAgentActivityItem[] = [
  {
    id: 'activity-1',
    at: '2026-06-15T11:58:00.000Z',
    action: 'fill',
    result: 'ok',
    secretId: 'secret-alpha-portal',
    secretName: 'Org Alpha portal',
    field: 'password',
    origin: 'https://portal.example.test',
    purpose: 'login',
    credentialKind: 'oauth',
    clientId: 'client-agent-runtime-a',
    clientName: 'Agent Runtime A',
  },
  {
    id: 'activity-2',
    at: '2026-06-15T11:57:00.000Z',
    action: 'fill',
    result: 'denied',
    reason: 'origin_mismatch',
    secretId: 'secret-alpha-portal',
    secretName: 'Org Alpha portal',
    field: 'password',
    origin: 'https://look-alike.example.test',
    purpose: 'login',
    credentialKind: 'oauth',
    clientId: 'client-agent-runtime-a',
    clientName: 'Agent Runtime A',
  },
];

test('opens a login to agents, reads the activity and saves the kill switch', async ({ page }) => {
  const api = await installMockApi(page);
  api.state.agentActivity.push(...ACTIVITY);

  // 1. Open the Credential and allow agents to use it.
  await page.goto('/secrets/secret-alpha-portal');
  await expect(page.getByRole('heading', { name: 'Org Alpha portal' })).toBeVisible();
  const toggle = page.getByLabel('Allow agents to use this login');
  await expect(toggle).not.toBeChecked();
  await toggle.click(); // a controlled switch: it flips once the PATCH returns
  await expect(page.getByText('Agents can now use this login')).toBeVisible();
  await expect(toggle).toBeChecked();
  expect(api.bodies['PATCH /secrets/secret-alpha-portal/agent-access']).toEqual([{ agentAccess: 'fill' }]);
  expect(api.state.agentAccess['secret-alpha-portal']).toBe('fill');

  // 2. The list marks it with the Agents chip, and only it.
  await page.goto('/secrets');
  await expect(page.getByText('Org Alpha portal').first()).toBeVisible();
  await expect(page.getByText('Agents', { exact: true })).toHaveCount(1);

  // 3. Settings, Agent activity: the rows, an OK result and a denied one, never a value.
  await page.goto('/settings');
  await page.getByRole('button', { name: /^Agent activity/ }).click();
  await expect(page).toHaveURL(/\/settings\/agent-activity$/);
  await expect(page.getByRole('heading', { name: 'Agent activity' }).first()).toBeVisible();
  await expect(page.getByText('Agent Runtime A').first()).toBeVisible();
  await expect(page.getByText('OK', { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel('Denied: origin_mismatch').first()).toBeVisible();
  await expect(page.getByText('example-password-not-real-1')).toHaveCount(0);

  // 4. Admin settings, Agent access: turn the kill switch on and save.
  await page.goto('/admin/settings');
  await page.getByRole('button', { name: /^Agent access/ }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/agent-access$/);
  const killSwitch = page.getByLabel('Allow agents to use opened logins');
  await expect(killSwitch).not.toBeChecked();
  await killSwitch.click();
  await expect(killSwitch).toBeChecked();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  const patches = api.bodies['PATCH /system-settings'] as Array<{ agentAccess: { enabled: boolean } }>;
  expect(patches).toHaveLength(1);
  expect(patches[0].agentAccess.enabled).toBe(true);
  expect(api.state.agentSettings).toMatchObject({ enabled: true });

  expect(api.unhandled).toEqual([]);
});
