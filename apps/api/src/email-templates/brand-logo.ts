import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { EmailBrandMark } from '@marinoscar/platform-api/email';

// =============================================================================
// The one image this application puts in an email (issue #85, E7.1)
// =============================================================================
//
// A single 96x96 PNG committed to the repository, embedded as a `Content-ID`
// part and rendered at 48x48 by the platform's email layout. It is the layout's
// BRAND MARK (`platform/email/email.options.ts` passes `emailBrandMark()` to
// `EmailModule.forRoot` as `layout.brandMark`), so every message carries it. No
// remote image is ever referenced.
//
// TO REBRAND: replace `apps/api/assets/email/logo.png` (a square PNG; 96x96 is
// the size that renders sharply at the 48px the layout states). It is a 2x
// reduction of `apps/web/public/icons/icon-192x192.png`.
//
// WHY `../../assets`: `apps/api/assets` sits BESIDE `src` and `dist`, so
// `<this file>/../../assets/email` is the same directory under ts-jest (from
// `src/email-templates`) and in the production image (from
// `dist/email-templates`, with the Dockerfile's `COPY assets ./assets/`). Do not
// move this file without changing the `..` count.
//
// A MISSING FILE IS NOT AN ERROR: `emailBrandMark()` returns `undefined` and the
// layout falls back to the text wordmark. A message without a logo is still a
// message; a message never sent because of a PNG is not.
// =============================================================================

/** `apps/api/assets/email`, from either `src/...` or `dist/...`. */
const EMAIL_ASSET_DIR = resolve(__dirname, '../../assets/email');

const LOGO_FILE = resolve(EMAIL_ASSET_DIR, 'logo.png');

/** The content id the layout writes into `src="cid:..."`. A handle no reader sees. */
export const EMAIL_LOGO_CID = 'brand-logo@email.local';

/** Rendered size, in CSS pixels. The asset is 2x this on each axis. */
export const EMAIL_LOGO_RENDERED_SIZE = 48;

/** `undefined` = not read yet, `null` = read and unavailable. */
let cached: EmailBrandMark | null | undefined;

/** The brand mark for `layout.brandMark`, or `undefined` when the asset is unreadable. */
export function emailBrandMark(): EmailBrandMark | undefined {
  if (cached !== undefined) return cached ?? undefined;

  try {
    cached = {
      pngBase64: readFileSync(LOGO_FILE).toString('base64'),
      cid: EMAIL_LOGO_CID,
      displaySize: EMAIL_LOGO_RENDERED_SIZE,
      // The product name sits beside the mark as text; an empty alt keeps a
      // screen reader from announcing it twice.
      alt: '',
    };
  } catch {
    cached = null;
  }

  return cached ?? undefined;
}

/** Drop the memoised read. FOR TESTS ONLY. */
export function resetEmailLogoCacheForTests(): void {
  cached = undefined;
}

/** Where the asset lives, so a test can assert against the real file. */
export const EMAIL_LOGO_PATH = LOGO_FILE;
