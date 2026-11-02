import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { VAULT_RAW_SQL_INDEXES, checkFragmentDeclarations, listPackageFragments, scanFragmentIndexes } from '../src/index.js';
import { PACKAGE_DIR } from './helpers.js';

const schemaDir = join(PACKAGE_DIR, 'schema');
const fragments = listPackageFragments(schemaDir).map((name) => ({ file: `schema/${name}`, text: readFileSync(join(schemaDir, name), 'utf8') }));

describe('raw-SQL index tripwire', () => {
  it('finds no fragment that redeclares a listed index', () => {
    expect(checkFragmentDeclarations(fragments, VAULT_RAW_SQL_INDEXES)).toEqual([]);
  });

  it('reads the declarations of the real fragments (the scan is not vacuous)', () => {
    const all = fragments.flatMap((fragment) => scanFragmentIndexes(fragment.file, fragment.text));
    expect(all.length).toBeGreaterThan(10);
    // The plain b-tree next to the partial unique index is a separate, legitimate index.
    expect(all.some((d) => d.table === 'secret_versions' && d.kind === '@@index' && d.columns.join() === 'secret_id,is_current')).toBe(true);
  });

  const secrets = fragments.find((fragment) => fragment.file.endsWith('vault.secrets.prisma'))!;

  it('fails when a fragment adds @@unique on the column of the partial unique index', () => {
    const edited = secrets.text.replace('model SecretVersion {\n', 'model SecretVersion {\n  @@unique([secretId])\n');
    expect(edited).not.toBe(secrets.text);
    const problems = checkFragmentDeclarations([{ file: secrets.file, text: edited }], VAULT_RAW_SQL_INDEXES);
    expect(problems.map((p) => p.code)).toEqual(['FRAGMENT_DECLARES_RAW_INDEX']);
    expect(problems[0]?.message).toContain('secret_versions_current_unique');
  });

  it('fails when a fragment declares an index under the name of a listed one', () => {
    const edited = secrets.text.replace('model SecretVersion {\n', 'model SecretVersion {\n  @@index([createdById], map: "secret_versions_current_unique")\n');
    expect(edited).not.toBe(secrets.text);
    const problems = checkFragmentDeclarations([{ file: secrets.file, text: edited }], VAULT_RAW_SQL_INDEXES);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('secret_versions_current_unique');
  });

  it('fails on a single-field @unique over the same key', () => {
    const text = 'model SecretVersion {\n  secretId String @unique @map("secret_id")\n  @@map("secret_versions")\n}\n';
    const problems = checkFragmentDeclarations([{ file: 'f.prisma', text }], VAULT_RAW_SQL_INDEXES);
    expect(problems).toHaveLength(1);
  });
});
