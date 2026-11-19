/**
 * Visual regression for the refreshed Vault UI (E10.7, #98).
 *
 * Eight screens at a phone (390 px) and a desktop (1440 px) viewport, light and
 * dark. The built app is served by `vite preview`; every `/api` call is answered
 * by `tests/support/mock-api.ts`. Update baselines: `docs/TESTING.md#visual`.
 */
import { expect, test, type Page } from '@playwright/test';
import { installMockApi } from '../../support/mock-api';
import { settle, stabilizePage, type Theme } from '../../support/stabilize';
import { PIXEL_PNG_BASE64 } from '../../support/fixtures';

const SCREENS: { name: string; path: string; ready: RegExp }[] = [
  { name: 'home', path: '/', ready: /Home|Welcome|Secrets/i },
  { name: 'secrets', path: '/secrets', ready: /Org Alpha portal/ },
  { name: 'secret-detail', path: '/secrets/secret-alpha-portal', ready: /Org Alpha portal/ },
  { name: 'cards', path: '/cards', ready: /Visa ending 1111/ },
  // ADR-0003 (#195): a card's Agent access panel with a merchant grant and a pending request.
  { name: 'card-detail', path: '/secrets/secret-card-visa', ready: /Allowed shops/ },
  // #207: a secret with a last-4 mask, a country and key/value entries.
  { name: 'keyvalue-detail', path: '/secrets/secret-document-fixture', ready: /Person A document/ },
  { name: 'user-settings', path: '/settings', ready: /Settings/i },
  { name: 'admin-settings', path: '/admin/settings', ready: /Settings|Administration|Console/i },
];
const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
];
const THEMES: Theme[] = ['light', 'dark'];

async function open(page: Page, path: string, theme: Theme, ready: RegExp) {
  await stabilizePage(page, { theme });
  const api = await installMockApi(page, { role: 'admin' });
  await page.goto(path);
  await expect(page.getByText(ready).first()).toBeVisible();
  await settle(page);
  return api;
}

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    test.describe(`${viewport.name} ${theme}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });
      for (const screen of SCREENS) {
        test(screen.name, async ({ page }) => {
          const api = await open(page, screen.path, theme, screen.ready);
          await expect(page).toHaveScreenshot(`${screen.name}-${viewport.name}-${theme}.png`, { fullPage: true });
          // A new API call on a screenshotted page must be mocked, not silently 404.
          expect(api.unhandled).toEqual([]);
        });
      }
    });
  }
}

/**
 * #211: the review step of "Scan an ID" — an invented specimen licence read by
 * the mocked extraction (AI and Check chips, the kind guess, an outlined
 * detail row), from a generated 1x1 placeholder image.
 */
for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    test.describe(`${viewport.name} ${theme} document scan`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });
      test('document-scan-review', async ({ page }) => {
        const api = await open(page, '/documents/scan', theme, /Scan an ID/);
        const photo = { name: 'front.png', mimeType: 'image/png', buffer: Buffer.from(PIXEL_PNG_BASE64, 'base64') };
        await page.getByTestId('document-front-library-input').setInputFiles(photo);
        await page.getByRole('button', { name: 'Continue' }).click();
        await page.getByRole('button', { name: /Skip/ }).click();
        await page.getByRole('button', { name: 'Continue to details' }).click();
        await expect(page.getByText(/AI guessed/)).toBeVisible();
        await settle(page);
        await expect(page).toHaveScreenshot(`document-scan-review-${viewport.name}-${theme}.png`, { fullPage: true });
        expect(api.unhandled).toEqual([]);
      });
    });
  }
}
