// =============================================================================
// apps/api HOLDS NO VAULT DOMAIN LOGIC (issue #103, E12.2, epic #67; ADR-0001)
// =============================================================================
//
// The Vault domain (secrets, secret types, attachments, the export zip, backups, media, card
// extraction, card-expiry reminders) lives once in `@marinoscar/vault-api`; `apps/api` binds the
// package's ports (`src/platform/vault-api/`), registers the platform extension points and boots.
// A second host would copy whatever stays here, so this test fails when domain logic comes back:
//
//   1. the moved folders do not exist under `src/` (and `src/ai` keeps only the one-off migration
//      commands, which are host glue);
//   2. no controller and no `@Cron` is declared in `src/` (the domain's routes and ticks are the
//      package's; the platform's are in the platform packages);
//   3. every import of `@marinoscar/vault-api` names a declared entry point (`./ports`, `./core`,
//      `./backups`, ...), never `dist/`, `src/` or an undeclared deep path;
//   4. no relative import reaches a moved folder;
//   5. only the listed host-glue files touch the domain tables through Prisma. Each is a platform
//      extension point (Doctor check, export source, onboarding fact, user-data purge) that reads
//      or purges domain rows; docs/platform-adoption/local-exceptions.md explains why they stay.
//      A new file here is a decision for a pull request, not an edit to make a failure go away; a
//      stale entry fails.
// =============================================================================

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import * as ts from 'typescript';

const API = resolve(__dirname, '..', '..');
const SRC = join(API, 'src');
const PACKAGE_JSON = resolve(API, '..', '..', 'packages', 'vault-api', 'package.json');

/** Folders that held domain logic before E12.2. */
const MOVED_DIRS = ['secrets', 'secret-types', 'media', 'backups', 'card-expiry'] as const;

/** What stays in `src/ai`: one-off migration commands (`npm run vault:migrate-ai-*`), not request-path code. */
const AI_HOST_FILES = new Set([
  'ai-key-migration.ts',
  'ai-key-migration.spec.ts',
  'ai-platform-migration.ts',
  'ai-platform-migration.spec.ts',
]);

/** Prisma delegates of the domain tables. */
const DOMAIN_MODELS = [
  'secret',
  'secretVersion',
  'secretAttachment',
  'secretType',
  'backupRun',
  'backupSchedule',
  'mediaFolder',
  'mediaFolderFile',
];

/** Host-glue files that read or purge domain rows through a platform extension point. */
const DOMAIN_TABLE_HOST_GLUE: Readonly<Record<string, string>> = {
  'doctor/checks/vault-encryption-key.doctor-check.ts': 'Doctor check: decrypts one stored version to prove the key (read-only rule)',
  'doctor/checks/vault-backup-schedule.doctor-check.ts': 'Doctor check: reads the schedule and the last run',
  'platform/exports/vault-secrets.source.ts': 'platform export source `vault-secrets` (secret metadata)',
  'platform/onboarding/onboarding.facts.ts': 'onboarding facts (counts of own secrets, backups, schedule)',
  'platform/user-data/factory-reset.steps.ts': 'factory-reset steps (platform registry)',
  'platform/user-data/vault-user-data-purge.handler.ts': 'user-data purge job (platform `user.data.purge` hook)',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const rel = (file: string) => relative(SRC, file).split(sep).join('/');

interface Edge {
  file: string;
  specifier: string;
}

function importsOf(file: string): Edge[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
  const edges: Edge[] = [];
  const add = (node: ts.Node | undefined) => {
    if (node && ts.isStringLiteralLike(node)) edges.push({ file, specifier: node.text });
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) add(node.moduleSpecifier);
    else if (ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
    else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      const isMock = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'jest' && /^(mock|doMock|requireActual)$/.test(callee.name.text);
      if (isImport || isRequire || isMock) add(node.arguments[0]);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return edges;
}

const srcFiles = walk(SRC);
const scriptFiles = existsSync(join(API, 'scripts')) ? walk(join(API, 'scripts')) : [];
const testFiles = walk(join(API, 'test'));
const allFiles = [...srcFiles, ...scriptFiles, ...testFiles, ...walk(join(API, 'prisma')).filter((f) => !f.includes(`${sep}migrations${sep}`))];

describe('apps/api holds no Vault domain logic (ADR-0001, issue #103)', () => {
  it('has none of the moved domain folders', () => {
    const present = MOVED_DIRS.filter((dir) => existsSync(join(SRC, dir)));
    expect(present).toEqual([]);
  });

  it('keeps only the one-off migration commands in src/ai', () => {
    const dir = join(SRC, 'ai');
    const extra = existsSync(dir) ? readdirSync(dir).filter((name) => !AI_HOST_FILES.has(name)) : [];
    expect(extra).toEqual([]);
  });

  it('declares no controller and no @Cron in src (the routes and ticks are the packages\')', () => {
    const hits = srcFiles
      .filter((file) => !file.endsWith('.spec.ts'))
      .filter((file) => /@Controller\(|@Cron\(/.test(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')))
      .map(rel);
    expect(hits).toEqual([]);
  });

  it('imports @marinoscar/vault-api only through its declared entry points', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as { exports: Record<string, unknown> };
    const allowed = new Set(Object.keys(pkg.exports).filter((key) => key !== './package.json').map((key) => `@marinoscar/vault-api${key.slice(1)}`));
    const bad = allFiles
      .flatMap(importsOf)
      .filter(({ specifier }) => specifier === '@marinoscar/vault-api' || specifier.startsWith('@marinoscar/vault-api/'))
      .filter(({ specifier }) => !allowed.has(specifier))
      .map(({ file, specifier }) => `${rel(file)} -> ${specifier}`);
    expect(bad).toEqual([]);
  });

  it('has no relative import into a moved folder', () => {
    const bad = allFiles
      .flatMap(importsOf)
      .filter(({ specifier }) => specifier.startsWith('.'))
      .filter(({ file, specifier }) => {
        const target = resolve(dirname(file), specifier);
        return MOVED_DIRS.some((dir) => target === join(SRC, dir) || target.startsWith(join(SRC, dir) + sep));
      })
      .map(({ file, specifier }) => `${rel(file)} -> ${specifier}`);
    expect(bad).toEqual([]);
  });

  describe('Prisma access to the domain tables', () => {
    const touching = (file: string) => {
      const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      return DOMAIN_MODELS.some((model) => new RegExp(`\\.${model}\\.(find|create|update|delete|count|aggregate|group|upsert)`).test(text));
    };

    it('happens only in the listed host-glue files', () => {
      const found = srcFiles.filter((file) => !file.endsWith('.spec.ts')).filter(touching).map(rel).sort();
      const unexpected = found.filter((file) => !(file in DOMAIN_TABLE_HOST_GLUE));
      expect(unexpected).toEqual([]);
    });

    it('lists no stale host-glue entry', () => {
      const found = new Set(srcFiles.filter((file) => !file.endsWith('.spec.ts')).filter(touching).map(rel));
      const stale = Object.keys(DOMAIN_TABLE_HOST_GLUE).filter((file) => !found.has(file));
      expect(stale).toEqual([]);
    });
  });
});
