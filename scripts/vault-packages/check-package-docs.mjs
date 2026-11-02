#!/usr/bin/env node
// =============================================================================
// Documentation check for the @marinoscar/vault-* packages
// =============================================================================
//
// A lighter form of the KVox check: Vault's packages have no TypeDoc build or
// `@stability` tags yet, so this checks the README standard only. For every
// package present under packages/ (a missing one is skipped):
//
//   readme-headings   README.md exists, starts with `# @marinoscar/<folder>`,
//                     and has each `##` section of REQUIRED_HEADINGS with text
//                     under it ("None." is text). Extra `##` sections are fine.
//   readme-status     "Purpose and scope" holds a line starting `Status:`.
//   readme-subpaths   The README names every entry point of the `exports` map
//                     (`@marinoscar/<folder>/<subpath>`; the root export is the
//                     package name itself).
//   links             Every relative Markdown link points at a file or folder
//                     that exists (anchors are not checked).
//
// Usage: node scripts/vault-packages/check-package-docs.mjs [--root <dir>]
// Exit: 0 clean, 1 violations, 2 usage error. Node built-ins only.
// =============================================================================

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { REPO_ROOT, listPackages } from './list-packages.mjs';

/** The `##` sections every package README must carry. */
export const REQUIRED_HEADINGS = Object.freeze([
  'Purpose and scope',
  'Install and peer dependencies',
  'Quick start',
  'Configuration',
  'Extension-point catalog',
  'Security notes',
  'Links',
]);

/** Splits Markdown into `{ title, sections: [{ heading, body }] }` at `#` and `##` lines outside code fences. */
export function parseMarkdown(text) {
  let title = null;
  const sections = [];
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const h1 = !inFence && /^#\s+(.+?)\s*$/.exec(line);
    const h2 = !inFence && /^##\s+(.+?)\s*$/.exec(line);
    if (h1 && title === null) title = h1[1];
    else if (h2) sections.push({ heading: h2[1], body: '' });
    else if (sections.length > 0) sections[sections.length - 1].body += `${line}\n`;
  }
  return { title, sections };
}

/** Relative Markdown links `[text](path)` outside code fences, without anchor or query. */
export function relativeLinks(text) {
  const out = [];
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) continue;
    for (const match of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) continue;
      out.push(target.split('#')[0].split('?')[0]);
    }
  }
  return out.filter((t) => t !== '');
}

/** The `exports` keys that are entry points (everything but `./package.json`). */
export function entryKeys(manifest) {
  return Object.keys(manifest.exports ?? {}).filter((key) => key !== './package.json');
}

/** Problems with one package; `{ rule, message }[]`. */
export function checkPackageDocs({ root, dir, manifest }) {
  const problems = [];
  const name = `@marinoscar/${dir}`;
  const folder = join(root, 'packages', dir);
  const add = (rule, message) => problems.push({ rule, message });
  const readmePath = join(folder, 'README.md');
  if (!existsSync(readmePath)) {
    add('readme-headings', `packages/${dir}/README.md does not exist`);
    return problems;
  }
  const text = readFileSync(readmePath, 'utf8');
  const parsed = parseMarkdown(text);
  if (parsed.title !== name) add('readme-headings', `packages/${dir}/README.md: first heading is '# ${parsed.title}', expected '# ${name}'`);
  for (const heading of REQUIRED_HEADINGS) {
    const section = parsed.sections.find((s) => s.heading === heading);
    if (!section) add('readme-headings', `packages/${dir}/README.md: missing section '## ${heading}'`);
    else if (section.body.trim() === '') add('readme-headings', `packages/${dir}/README.md: section '## ${heading}' is empty (write "None." and why)`);
  }
  const purpose = parsed.sections.find((s) => s.heading === 'Purpose and scope');
  if (purpose && !/^Status:\s*\S/m.test(purpose.body)) add('readme-status', `packages/${dir}/README.md: 'Purpose and scope' has no line starting 'Status:'`);
  for (const key of entryKeys(manifest)) {
    const specifier = key === '.' ? name : `${name}/${key.slice(2)}`;
    if (!text.includes(specifier)) add('readme-subpaths', `packages/${dir}/README.md never mentions the entry point '${specifier}'`);
  }
  for (const target of relativeLinks(text)) {
    if (!existsSync(resolve(folder, target))) add('links', `packages/${dir}/README.md links to '${target}', which does not exist`);
  }
  return problems;
}

/** Checks every package present under root. */
export function checkAllPackageDocs(root) {
  return listPackages(root).flatMap((pkg) =>
    checkPackageDocs({ root, ...pkg }).map((p) => ({ package: pkg.name, ...p })),
  );
}

function main() {
  const argv = process.argv.slice(2);
  let root = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root' && argv[i + 1] !== undefined) {
      root = argv[i + 1];
      i += 1;
    } else {
      console.error(`check-package-docs: unknown argument '${argv[i]}'\nUsage: node scripts/vault-packages/check-package-docs.mjs [--root <dir>]`);
      process.exit(2);
    }
  }
  const repoRoot = resolve(root ?? REPO_ROOT);
  const count = listPackages(repoRoot).length;
  if (count === 0) {
    console.error('check-package-docs: no packages/vault-* package found');
    process.exit(2);
  }
  const violations = checkAllPackageDocs(repoRoot);
  if (violations.length === 0) {
    console.log(`Package docs check passed (${count} packages).`);
    process.exit(0);
  }
  for (const { package: pkg, rule, message } of violations) console.error(`[${rule}] ${pkg}: ${message}`);
  console.error(`\nPackage docs check FAILED: ${violations.length} problem${violations.length === 1 ? '' : 's'}. The standard: docs/PACKAGES.md`);
  process.exit(1);
}

const isDirectExecution =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) main();
