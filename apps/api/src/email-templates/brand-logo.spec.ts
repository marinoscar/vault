import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  EMAIL_LOGO_CID,
  EMAIL_LOGO_PATH,
  EMAIL_LOGO_RENDERED_SIZE,
  emailBrandMark,
  resetEmailLogoCacheForTests,
} from './brand-logo';

const apiRoot = resolve(__dirname, '../..');

describe('the committed email logo asset', () => {
  afterEach(() => resetEmailLogoCacheForTests());

  it('lives in apps/api/assets, beside src and dist', () => {
    expect(EMAIL_LOGO_PATH).toBe(resolve(apiRoot, 'assets/email/logo.png'));
  });

  it('resolves to the same path from dist/ as from src/', () => {
    expect(resolve(apiRoot, 'dist/email-templates', '../../assets/email/logo.png')).toBe(EMAIL_LOGO_PATH);
  });

  it('is a 96x96 PNG, twice the rendered size', () => {
    const bytes = readFileSync(EMAIL_LOGO_PATH);
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.readUInt32BE(16)).toBe(EMAIL_LOGO_RENDERED_SIZE * 2);
    expect(bytes.readUInt32BE(20)).toBe(EMAIL_LOGO_RENDERED_SIZE * 2);
  });

  it('builds the brand mark the layout embeds', () => {
    const mark = emailBrandMark();
    expect(mark).toMatchObject({ cid: EMAIL_LOGO_CID, displaySize: EMAIL_LOGO_RENDERED_SIZE });
    expect(Buffer.from(mark!.pngBase64, 'base64').equals(readFileSync(EMAIL_LOGO_PATH))).toBe(true);
  });

  it('returns the same object on every call', () => {
    expect(emailBrandMark()).toBe(emailBrandMark());
  });
});
