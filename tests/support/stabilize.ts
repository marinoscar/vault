/**
 * Determinism for the visual and e2e suites (E10.7, #98).
 *
 * `stabilizePage(page, { theme })` pins everything a screenshot could depend on
 * besides the app itself: the clock, the theme, the fonts and the animations.
 * Context-level settings (locale, timezone, viewport, reduced motion) are in
 * each suite's `playwright.config.ts`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { FROZEN_NOW } from './fixtures';

const here = dirname(fileURLToPath(import.meta.url));
const font = (file: string) => `data:font/woff2;base64,${readFileSync(join(here, 'fonts', file)).toString('base64')}`;

const FONT_CSS = [
  ['Inter', 400, 'Inter-Regular.woff2'],
  ['Inter', 500, 'Inter-Medium.woff2'],
  ['Inter', 600, 'Inter-SemiBold.woff2'],
  ['Inter', 700, 'Inter-Bold.woff2'],
  ['Vault Mono', 400, 'DejaVuSansMono.woff2'],
]
  .map(
    ([family, weight, file]) =>
      `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;font-display:block;src:url(${font(String(file))}) format('woff2');}`,
  )
  .join('\n');

const OVERRIDE_CSS = `
*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important;}
`;

export type Theme = 'light' | 'dark';

export async function stabilizePage(page: Page, options: { theme?: Theme } = {}): Promise<void> {
  const { theme = 'light' } = options;
  await page.clock.setFixedTime(new Date(FROZEN_NOW));
  await page.addInitScript(
    ({ fontCss, overrideCss, mode }) => {
      try {
        window.localStorage.setItem('theme_mode', mode);
      } catch {
        /* storage unavailable */
      }
      const install = () => {
        const style = document.createElement('style');
        style.setAttribute('data-e2e-stabilize', '');
        style.textContent = fontCss + overrideCss;
        document.head.appendChild(style);
      };
      if (document.head) install();
      else document.addEventListener('DOMContentLoaded', install, { once: true });
    },
    { fontCss: FONT_CSS, overrideCss: OVERRIDE_CSS, mode: theme },
  );
}

/**
 * Call just before a screenshot: waits for fonts, and swaps the generic
 * `monospace` family (which `@font-face` cannot override) for the vendored one.
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const family = getComputedStyle(el).fontFamily;
      if (/monospace/i.test(family) && !/Vault Mono/.test(family)) el.style.fontFamily = "'Vault Mono'";
    }
    await Promise.all([
      document.fonts.load("400 16px 'Inter'"),
      document.fonts.load("600 16px 'Inter'"),
      document.fonts.load("400 14px 'Vault Mono'"),
    ]);
    await document.fonts.ready;
  });
  await page.waitForLoadState('networkidle');
}
