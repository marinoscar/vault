// =============================================================================
// The `vault-secrets` export source (issue #91, E9.3, epic #64)
// =============================================================================
//
// The part of "Download your data" that describes a user's secrets WITHOUT
// containing one. The platform's `user-data` source cannot do it: `Secret` and
// `SecretVersion` are `export: 'exclude'` in the user-owned registry
// (`app-registrations/user-owned-models.ts`), because a secret's values are
// ciphertext and leave the deployment only inside Vault's own password-protected
// zip (`POST /api/secrets/export`, docs/SECRETS.md). This source exports METADATA
// only, by an explicit column list:
//
//   secrets             id, name, type, created / updated timestamps, how many
//                       versions it has, the current version number, how many
//                       attachments it has
//   secret_attachments  id, secret, version number, role, label, created timestamp
//
// What it NEVER reads, so it cannot write: `encryptedData`, `iv`, `authTag` (the
// ciphertext), the decrypted data of any version, a storage key, a file's bytes,
// a card number or CVV. Every cell is copied from a named property of the row
// (never `...row`), so a client that ignores `select` (the conformance fake does)
// still cannot leak a column. A secret's description is also left out: it is
// free text the user may have used as a hint.
//
// Every query names its owner (`createdById` = the requester) because the client is
// the bypass client. Read-only, paged by id. Registered by `exports.config.ts`
// AFTER `ExportsModule.forRoot`, so `user-data` stays the first (default) source.
// Permission `user_settings:read`, the string `user-data` enforces: every role may
// export its own data. The values are in the password-protected zip, which the
// export page links to (`web: components/exports/VaultExportNotice.tsx`).
// =============================================================================

import { z } from 'zod';
import {
  CSV_EXPORT_WRITER,
  JSON_EXPORT_WRITER,
  MODEL_TABLE_COLUMN_TYPES,
  XLSX_EXPORT_WRITER,
  type ExportColumn,
  type ExportContext,
  type ExportRow,
  type ExportSource,
  type ExportTable,
} from '@marinoscar/platform-api/exports';

/** The source id. PERMANENT once export jobs carry it. */
export const VAULT_SECRETS_EXPORT_SOURCE_ID = 'vault-secrets';

/** The permission the route enforces: the one `user-data` uses, held by every role. */
export const VAULT_SECRETS_EXPORT_PERMISSION = 'user_settings:read';

const SECRET_COLUMNS: readonly ExportColumn[] = [
  { key: 'id', label: 'Id', type: 'string' },
  { key: 'name', label: 'Name', type: 'string' },
  { key: 'type', label: 'Type', type: 'string' },
  { key: 'createdAt', label: 'Created at', type: 'datetime' },
  { key: 'updatedAt', label: 'Updated at', type: 'datetime' },
  { key: 'versionCount', label: 'Versions', type: 'number' },
  { key: 'currentVersion', label: 'Current version', type: 'number' },
  { key: 'attachmentCount', label: 'Attachments', type: 'number' },
];

const ATTACHMENT_COLUMNS: readonly ExportColumn[] = [
  { key: 'id', label: 'Id', type: 'string' },
  { key: 'secretId', label: 'Secret id', type: 'string' },
  { key: 'version', label: 'Secret version', type: 'number' },
  { key: 'role', label: 'Role', type: 'string' },
  { key: 'label', label: 'Label', type: 'string' },
  { key: 'createdAt', label: 'Created at', type: 'datetime' },
];

const iso = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : null;
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const count = (value: unknown): number => (typeof value === 'number' ? value : 0);

async function* secretRows(ctx: ExportContext): AsyncGenerator<ExportRow> {
  let after: string | undefined;
  for (;;) {
    const page: Record<string, any>[] = await ctx.db.secret.findMany({
      where: { createdById: ctx.subjectId, ...(after ? { id: { gt: after } } : {}) },
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        type: { select: { name: true } },
        versions: { where: { isCurrent: true }, select: { version: true }, take: 1 },
        _count: { select: { versions: true, attachments: true } },
      },
      orderBy: { id: 'asc' },
      take: ctx.pageSize,
    });
    for (const secret of page) {
      yield {
        id: text(secret.id),
        name: text(secret.name),
        type: text(secret.type?.name),
        createdAt: iso(secret.createdAt),
        updatedAt: iso(secret.updatedAt),
        versionCount: count(secret._count?.versions),
        currentVersion: Array.isArray(secret.versions) && secret.versions[0] ? count(secret.versions[0].version) : null,
        attachmentCount: count(secret._count?.attachments),
      };
    }
    if (page.length < ctx.pageSize) return;
    after = page[page.length - 1].id as string;
  }
}

async function* attachmentRows(ctx: ExportContext): AsyncGenerator<ExportRow> {
  let after: string | undefined;
  for (;;) {
    const page: Record<string, any>[] = await ctx.db.secretAttachment.findMany({
      where: { secret: { createdById: ctx.subjectId }, ...(after ? { id: { gt: after } } : {}) },
      select: {
        id: true,
        secretId: true,
        role: true,
        label: true,
        createdAt: true,
        secretVersion: { select: { version: true } },
      },
      orderBy: { id: 'asc' },
      take: ctx.pageSize,
    });
    for (const attachment of page) {
      yield {
        id: text(attachment.id),
        secretId: text(attachment.secretId),
        version: attachment.secretVersion ? count(attachment.secretVersion.version) : null,
        role: text(attachment.role),
        label: text(attachment.label),
        createdAt: iso(attachment.createdAt),
      };
    }
    if (page.length < ctx.pageSize) return;
    after = page[page.length - 1].id as string;
  }
}

/** The datasets of one user's export. Exposed for the specs. */
export async function* vaultSecretsTables(ctx: ExportContext): AsyncGenerator<ExportTable> {
  yield { dataset: 'secrets', title: 'Secrets (metadata only)', columns: SECRET_COLUMNS, rows: secretRows(ctx) };
  yield {
    dataset: 'secret_attachments',
    title: 'Secret attachments (metadata only)',
    columns: ATTACHMENT_COLUMNS,
    rows: attachmentRows(ctx),
  };
}

/**
 * Names, types, timestamps and counts of the caller's secrets and their attachments. Never a
 * value, never ciphertext. No request options.
 */
export const VAULT_SECRETS_EXPORT_SOURCE: ExportSource<Record<string, never>> = {
  id: VAULT_SECRETS_EXPORT_SOURCE_ID,
  scope: 'user',
  label: 'Secrets (metadata only)',
  description:
    'The names, types, timestamps and version counts of your secrets and their attachments. Secret values are never part of this download: export them with a password from My backups.',
  permission: VAULT_SECRETS_EXPORT_PERMISSION,
  requestSchema: z.object({}).strict(),
  // LISTED, unlike `user-data`: the built-in writers attach only to the platform's own source ids.
  formats: [JSON_EXPORT_WRITER.id, CSV_EXPORT_WRITER.id, XLSX_EXPORT_WRITER.id],
  columnTypes: MODEL_TABLE_COLUMN_TYPES,
  collect: (ctx) => vaultSecretsTables(ctx),
};
