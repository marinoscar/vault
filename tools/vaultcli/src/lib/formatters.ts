import chalk from 'chalk';
import { header, keyValue, tableHeader, tableRow, blank, statusBadge, section, dim } from '../utils/output.js';
import type {

  HealthResponse,
  PaginatedResponse,
  Secret,
  SecretListItem,
  SecretType,
  SecretVersion,
  SyncRegistry,
  SyncResult,
  SyncRunSummary,
} from '../utils/types.js';

// ---------------------------------------------------------------------------
// General utilities
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number | string | null): string {
  const n = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes;
  if (n === null || n === undefined || isNaN(n)) return '-';
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function truncate(s: string, len: number): string {
  if (s.length <= len) return s;
  return s.slice(0, len - 1) + '\u2026';
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

export function formatSecretTable(result: PaginatedResponse<SecretListItem>): void {
  const widths = [10, 14, 30, 20, 5, 12];
  header(`Secrets (${result.meta.totalItems} total, page ${result.meta.page}/${result.meta.totalPages})`);
  tableHeader(['ID', 'Type', 'Name', 'Description', 'Ver', 'Updated'], widths);

  for (const item of result.items) {
    tableRow(
      [
        shortId(item.id),
        truncate(item.type?.name ?? '-', 14),
        truncate(item.name, 30),
        truncate(item.description ?? '-', 20),
        item.currentVersion != null ? String(item.currentVersion) : '-',
        shortDate(item.updatedAt),
      ],
      widths,
    );
  }
  blank();
}

export function formatSecretDetail(secret: Secret): void {
  header('Secret');
  keyValue('ID', secret.id);
  keyValue('Name', secret.name);
  keyValue('Description', secret.description ?? '-');
  keyValue('Type', secret.type ? `${secret.type.name} (${secret.type.icon ?? '-'})` : secret.typeId);
  keyValue('Type ID', secret.typeId);
  keyValue('Created', formatDate(secret.createdAt));
  keyValue('Updated', formatDate(secret.updatedAt));
  keyValue('Version', secret.currentVersion != null ? String(secret.currentVersion) : '-');

  if (secret.attachments && secret.attachments.length > 0) {
    keyValue('Attachments', String(secret.attachments.length));
  }

  if (secret.values) {
    section('Data Fields');
    for (const [key, value] of Object.entries(secret.values)) {
      const display = String(value ?? '');
      keyValue(`  ${key}`, display);
    }
  }

  if (secret.attachments && secret.attachments.length > 0) {
    section('Attachments');
    const aWidths = [10, 20, 25, 10, 10];
    tableHeader(['ID', 'Label', 'File', 'Size', 'Status'], aWidths);
    for (const att of secret.attachments) {
      tableRow(
        [
          shortId(att.id),
          truncate(att.label ?? '-', 20),
          truncate(att.storageObject?.name ?? '-', 25),
          formatBytes(att.storageObject?.size ?? null),
          att.storageObject?.status ? statusBadge(att.storageObject.status) : '-',
        ],
        aWidths,
      );
    }
  }

  blank();
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export function formatVersionTable(versions: SecretVersion[]): void {
  const widths = [8, 10, 9, 25, 18];
  header(`Versions (${versions.length} total)`);
  tableHeader(['Version', 'ID', 'Current', 'Created By', 'Created'], widths);

  for (const v of versions) {
    tableRow(
      [
        `v${v.version}`,
        shortId(v.id),
        v.isCurrent ? statusBadge('current') : chalk.dim('no'),
        v.createdBy ? truncate(v.createdBy.email, 25) : '-',
        shortDate(v.createdAt),
      ],
      widths,
    );
  }
  blank();
}

export function formatVersionDetail(version: SecretVersion): void {
  header(`Version v${version.version}`);
  keyValue('ID', version.id);
  keyValue('Version', String(version.version));
  keyValue('Current', version.isCurrent ? chalk.green('Yes') : 'No');
  keyValue('Created', formatDate(version.createdAt));

  if (version.createdBy) {
    keyValue('Created By', `${version.createdBy.email}${version.createdBy.displayName ? ` (${version.createdBy.displayName})` : ''}`);
  }

  if (version.values) {
    section('Data Fields');
    for (const [key, value] of Object.entries(version.values)) {
      keyValue(`  ${key}`, String(value ?? ''));
    }
  }

  blank();
}

// ---------------------------------------------------------------------------
// Secret Types
// ---------------------------------------------------------------------------

export function formatSecretTypeTable(types: SecretType[]): void {
  const widths = [10, 22, 8, 12, 8];
  header(`Secret Types (${types.length} total)`);
  tableHeader(['ID', 'Name', 'Fields', 'Attachments', 'System'], widths);

  for (const t of types) {
    tableRow(
      [
        shortId(t.id),
        truncate(t.name, 22),
        String(t.fields?.length ?? 0),
        t.allowAttachments ? chalk.green('Yes') : chalk.dim('No'),
        t.isSystem ? chalk.yellow('Yes') : chalk.dim('No'),
      ],
      widths,
    );
  }
  blank();
}

export function formatSecretTypeDetail(type: SecretType): void {
  header('Secret Type');
  keyValue('ID', type.id);
  keyValue('Name', type.name);
  keyValue('Description', type.description ?? '-');
  keyValue('Icon', type.icon ?? '-');
  keyValue('System', type.isSystem ? 'Yes' : 'No');
  keyValue('Allow Attachments', type.allowAttachments ? 'Yes' : 'No');
  keyValue('Created', formatDate(type.createdAt));
  keyValue('Updated', formatDate(type.updatedAt));

  if (type.fields && type.fields.length > 0) {
    section('Field Definitions');
    const fWidths = [16, 20, 10, 10, 10];
    tableHeader(['Name', 'Label', 'Type', 'Required', 'Sensitive'], fWidths);
    for (const f of type.fields) {
      tableRow(
        [
          f.name,
          truncate(f.label, 20),
          f.type,
          f.required ? chalk.yellow('Yes') : chalk.dim('No'),
          f.sensitive ? chalk.red('Yes') : chalk.dim('No'),
        ],
        fWidths,
      );
    }
  }

  blank();
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export function formatSyncList(registry: SyncRegistry): void {
  const files = registry.entries.filter((e) => e.kind === 'file');
  const dirs = registry.entries.filter((e) => e.kind === 'dir');

  header(`Synced files (${files.length} file${files.length === 1 ? '' : 's'}, ${dirs.length} dir${dirs.length === 1 ? '' : 's'})`);

  if (files.length > 0) {
    const widths = [26, 34, 16, 12];
    tableHeader(['Name', 'Path', 'Status', 'Last Synced'], widths);
    for (const e of files) {
      if (e.kind !== 'file') continue;
      const status = e.secretId
        ? chalk.green(`synced (v${e.lastVersion ?? '?'})`)
        : chalk.yellow('not-yet-created');
      tableRow(
        [
          truncate(e.name, 26),
          truncate(e.path, 34),
          status,
          e.lastSyncedAt ? shortDate(e.lastSyncedAt) : '-',
        ],
        widths,
      );
    }
  }

  if (dirs.length > 0) {
    section('Watched directories');
    const widths = [34, 14, 12, 16];
    tableHeader(['Path', 'Pattern', 'Recursive', 'Name Prefix'], widths);
    for (const e of dirs) {
      if (e.kind !== 'dir') continue;
      tableRow(
        [
          truncate(e.path, 34),
          e.pattern,
          e.recursive ? chalk.green('Yes') : chalk.dim('No'),
          e.namePrefix ?? chalk.dim('(dir name)'),
        ],
        widths,
      );
    }
  }

  if (files.length === 0 && dirs.length === 0) {
    keyValue('Status', 'No files or directories registered yet');
    dim('  Add one with: vaultcli sync add --name <name> --path <file>');
  }

  blank();
}

function syncActionBadge(action: string, dryRun: boolean): string {
  const verb = dryRun
    ? { created: 'would-create', updated: 'would-update', unchanged: 'unchanged', error: 'error' }[action] ?? action
    : action;
  const color: Record<string, (s: string) => string> = {
    created: chalk.green,
    updated: chalk.cyan,
    unchanged: chalk.dim,
    error: chalk.red,
  };
  const fn = color[action] || chalk.white;
  return fn(verb);
}

export function formatSyncRun(
  results: SyncResult[],
  summary: SyncRunSummary,
  dryRun: boolean,
): void {
  header(dryRun ? 'Sync (dry run)' : 'Sync');
  const widths = [16, 28, 38];
  tableHeader(['Action', 'Name', 'Detail'], widths);

  for (const r of results) {
    let detail: string;
    if (r.action === 'error') {
      detail = chalk.red(r.reason ?? 'error');
    } else if (r.action === 'unchanged') {
      detail = r.version != null ? `v${r.version}` : '-';
    } else {
      const ver = r.version != null ? `v${r.version}` : '';
      const att = r.attachmentSynced === false ? chalk.yellow(' (no attachment)') : '';
      detail = `${ver}${att}`;
    }
    tableRow([syncActionBadge(r.action, dryRun), truncate(r.name, 28), detail], widths);
  }

  blank();
  const parts = [
    chalk.green(`${summary.created} created`),
    chalk.cyan(`${summary.updated} updated`),
    chalk.dim(`${summary.unchanged} unchanged`),
    summary.errors > 0 ? chalk.red(`${summary.errors} errors`) : chalk.dim('0 errors'),
  ];
  keyValue('Summary', parts.join(', '));
  blank();
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export function formatHealthDetail(health: HealthResponse, label: string): void {
  header(`Health — ${label}`);
  const badge = health.status === 'ok' ? chalk.green('\u2714 OK') : chalk.red('\u2718 UNHEALTHY');
  keyValue('Status', badge);
  if (health.timestamp) keyValue('Timestamp', health.timestamp);
  if (health.database) keyValue('Database', health.database);
  blank();
}
