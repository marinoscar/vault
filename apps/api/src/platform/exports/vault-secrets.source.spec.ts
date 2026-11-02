// The `vault-secrets` export source (issue #91, E9.3): metadata only, by an explicit column list.
// The fake client returns, for every model, one row whose EVERY scalar holds a sentinel and ignores
// `select` (the worst case), so a column the source copied by accident would show in the output.

import { Prisma } from '@prisma/client';
import {
  CSV_EXPORT_WRITER,
  JSON_EXPORT_WRITER,
  XLSX_EXPORT_WRITER,
  BUILTIN_EXPORT_WRITERS,
  type ExportContext,
} from '@marinoscar/platform-api/exports';
import {
  collectExportOutput,
  exportFileText,
  exportSentinel,
  sentinelExportDb,
} from '@marinoscar/platform-api/exports/testing';

import {
  VAULT_SECRETS_EXPORT_PERMISSION,
  VAULT_SECRETS_EXPORT_SOURCE,
  VAULT_SECRETS_EXPORT_SOURCE_ID,
  vaultSecretsTables,
} from './vault-secrets.source';

const USER = '3f2b8f0e-6c1d-4f4b-9a55-1c2d3e4f5a6b';

function context(db: ExportContext['db']): ExportContext {
  return {
    exportId: 'export-1',
    scope: 'user',
    subjectId: USER,
    requestedById: USER,
    db,
    datamodel: Prisma.dmmf.datamodel as never,
    pageSize: 10,
    now: new Date('2027-01-02T03:04:05.000Z'),
    timeZone: 'UTC',
  };
}

/** Every column of the model that must never leave through this source. */
const FORBIDDEN = [
  exportSentinel('SecretVersion', 'encryptedData'),
  exportSentinel('SecretVersion', 'iv'),
  exportSentinel('SecretVersion', 'authTag'),
  exportSentinel('Secret', 'description'),
  exportSentinel('SecretAttachment', 'storageObjectId'),
  exportSentinel('SecretAttachment', 'secretVersionId'),
];

describe('vault-secrets export source', () => {
  it('is a user source gated by the permission every role holds, with the three built-in formats', () => {
    expect(VAULT_SECRETS_EXPORT_SOURCE.id).toBe(VAULT_SECRETS_EXPORT_SOURCE_ID);
    expect(VAULT_SECRETS_EXPORT_SOURCE.scope).toBe('user');
    expect(VAULT_SECRETS_EXPORT_SOURCE.permission).toBe(VAULT_SECRETS_EXPORT_PERMISSION);
    expect(VAULT_SECRETS_EXPORT_PERMISSION).toBe('user_settings:read');
    expect(VAULT_SECRETS_EXPORT_SOURCE.formats).toEqual(['json', 'csv', 'xlsx']);
    // Every listed format is a built-in writer (registered by `ExportsModule.forRoot`).
    const builtIn = BUILTIN_EXPORT_WRITERS.map((writer) => writer.id);
    for (const format of VAULT_SECRETS_EXPORT_SOURCE.formats) expect(builtIn).toContain(format);
  });

  it('accepts no request option', () => {
    expect(VAULT_SECRETS_EXPORT_SOURCE.requestSchema.safeParse({}).success).toBe(true);
    expect(VAULT_SECRETS_EXPORT_SOURCE.requestSchema.safeParse({ includeValues: true }).success).toBe(false);
  });

  it('declares only metadata columns: no ciphertext, no value, no storage key', () => {
    const keys: string[] = [];
    const tables = vaultSecretsTables(context(sentinelExportDb(Prisma.dmmf.datamodel as never)));
    return (async () => {
      for await (const table of tables) keys.push(...table.columns.map((column) => `${table.dataset}.${column.key}`));
      expect(keys).toEqual([
        'secrets.id',
        'secrets.name',
        'secrets.type',
        'secrets.createdAt',
        'secrets.updatedAt',
        'secrets.versionCount',
        'secrets.currentVersion',
        'secrets.attachmentCount',
        'secret_attachments.id',
        'secret_attachments.secretId',
        'secret_attachments.version',
        'secret_attachments.role',
        'secret_attachments.label',
        'secret_attachments.createdAt',
      ]);
      const joined = keys.join(' ').toLowerCase();
      for (const banned of ['encrypted', 'cipher', 'authtag', 'iv', 'data', 'value', 'key', 'description']) {
        expect(joined.split(/[ .]/)).not.toContain(banned);
      }
    })();
  });

  it('filters by the requester, reaching secrets through createdById and attachments through their secret', async () => {
    const calls: Array<{ model: string; where: unknown }> = [];
    const db = {
      secret: { findMany: async (args: { where: unknown }) => (calls.push({ model: 'secret', where: args.where }), []) },
      secretAttachment: {
        findMany: async (args: { where: unknown }) => (calls.push({ model: 'secretAttachment', where: args.where }), []),
      },
    };
    for await (const table of vaultSecretsTables(context(db as never))) {
      for await (const _row of table.rows) void _row;
    }
    expect(calls).toEqual([
      { model: 'secret', where: { createdById: USER } },
      { model: 'secretAttachment', where: { secret: { createdById: USER } } },
    ]);
  });

  it.each([
    ['json', JSON_EXPORT_WRITER],
    ['csv', CSV_EXPORT_WRITER],
    ['xlsx', XLSX_EXPORT_WRITER],
  ])('writes the metadata and none of the forbidden columns with the %s writer', async (_id, writer) => {
    const ctx = context(sentinelExportDb(Prisma.dmmf.datamodel as never));
    const { bytes } = await collectExportOutput(writer, vaultSecretsTables(ctx), VAULT_SECRETS_EXPORT_SOURCE_ID);
    const text = exportFileText(bytes);

    expect(text).toContain(exportSentinel('Secret', 'name'));
    expect(text).toContain(exportSentinel('SecretAttachment', 'label'));
    for (const forbidden of FORBIDDEN) expect(text).not.toContain(forbidden);
  });
});
