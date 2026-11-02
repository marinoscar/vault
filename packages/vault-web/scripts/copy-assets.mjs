// Copies the non-TypeScript files the compiled modules import (the brand mark)
// next to them in dist/, so a consumer's bundler resolves
// `./assets/vault-mark.png` from `dist/brand/BrandLockup.js` as it does from
// the source. Runs after `tsc -p tsconfig.build.json` (`postbuild`).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSET = /\.(png|svg|ico|webp)$/;

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (ASSET.test(e.name)) {
      const dest = path.join(root, 'dist', path.relative(path.join(root, 'src'), p));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(p, dest);
    }
  }
}
walk(path.join(root, 'src'));
