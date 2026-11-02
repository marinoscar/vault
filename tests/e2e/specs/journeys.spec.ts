/**
 * Critical journeys (E10.7, #98): sign in, create a secret, reveal and copy a
 * value, import a card with a mocked AI extraction, save a My backup.
 * The network is mocked (`tests/support/mock-api.ts`); the real API is not used.
 */
import { expect, test } from '@playwright/test';
import { PIXEL_PNG_BASE64 } from '../../support/fixtures';
import { installMockApi } from '../../support/mock-api';
import { stabilizePage } from '../../support/stabilize';

test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
});

test('signs in with the provider button and lands on Home', async ({ page }) => {
  const api = await installMockApi(page, { signedIn: false });
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole('button', { name: /Continue with Google/i }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Person A/ })).toBeVisible();
  expect(api.unhandled).toEqual([]);
});

test('creates a secret and sees it in the list', async ({ page }) => {
  const api = await installMockApi(page);
  await page.goto('/secrets/new');
  await page.getByRole('combobox', { name: 'Type' }).click();
  await page.getByRole('option', { name: /Credential/ }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Org Alpha staging login');
  await page.getByLabel(/^Username/).fill('person.a@example.test');
  await page.getByLabel(/^Password/).first().fill('not-a-real-password');
  await page.getByRole('button', { name: 'Create secret' }).click();
  await expect(page.getByRole('heading', { name: 'Org Alpha staging login' })).toBeVisible();
  expect(api.state.secrets[0].name).toBe('Org Alpha staging login');
  await page.goto('/secrets');
  await expect(page.getByText('Org Alpha staging login')).toBeVisible();
  expect(api.unhandled).toEqual([]);
});

test('reveals and copies a secret value', async ({ page }) => {
  const api = await installMockApi(page);
  await page.goto('/secrets/secret-alpha-portal');
  await expect(page.getByRole('heading', { name: 'Org Alpha portal' })).toBeVisible();
  await expect(page.getByText('person.a@example.test').first()).toBeVisible();
  await expect(page.getByText('example-password-not-real-1')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reveal Password' }).click();
  await expect(page.getByText('example-password-not-real-1')).toBeVisible();
  await page.getByRole('button', { name: 'Copy Username' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('person.a@example.test');
  expect(api.unhandled).toEqual([]);
});

test('imports a card with a mocked AI extraction', async ({ page }) => {
  const api = await installMockApi(page);
  await page.goto('/cards/import');
  await expect(page.getByRole('heading', { name: 'Scan a card' })).toBeVisible();
  const photo = { name: 'front.png', mimeType: 'image/png', buffer: Buffer.from(PIXEL_PNG_BASE64, 'base64') };
  await page.getByTestId('card-front-library-input').setInputFiles(photo);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Skip/ }).click();
  await expect(page.getByRole('heading', { name: 'Check the crop' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to details' }).click();
  await expect(page.getByRole('heading', { name: 'Check the details' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).not.toHaveValue('');
  // The CVV is never read from the photo; the user types it.
  await page.getByLabel(/CVV|CVC/).first().fill('123');
  await page.getByRole('button', { name: 'Save card' }).click();
  await expect.poll(() => api.bodies['POST /secrets']?.length ?? 0).toBe(1);
  expect(api.bodies['POST /secrets/cards/extract']?.length).toBe(1);
  expect(api.unhandled).toEqual([]);
});

test('saves a My backup to storage', async ({ page }) => {
  const api = await installMockApi(page);
  await page.goto('/settings/backups');
  await page.getByLabel('Save to the storage account').check();
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery staple 42');
  await page.getByLabel('Confirm password').fill('correct horse battery staple 42');
  await page.getByRole('button', { name: 'Save backup' }).click();
  await expect.poll(() => api.bodies['POST /backups/me']?.length ?? 0).toBe(1);
  expect(api.state.backups.length).toBe(1);
  expect(api.unhandled).toEqual([]);
});
