import { isBrowserRenderableImage } from './attachment-file-name';
import {
  ExportAttachmentEntry,
  ExportFieldDefinition,
  ExportSecretEntry,
  ExportVersionEntry,
  SecretsExportManifest,
} from './secrets-export.types';

/**
 * Renders `secrets.html`: a self-contained, human-readable report of a backup.
 *
 * Rules this file must keep:
 *   - No scripts and no external resources. The only URLs are relative links
 *     to `attachments/...` inside the same archive. A CSP meta tag forbids
 *     scripts, plugins, forms and `<base>` as defence in depth.
 *   - Every value that came from the database or a user goes through
 *     `escapeHtml`, including the ones that "can only be" a uuid or a date.
 *   - Pure: the output is a function of the manifest alone, so it is unit
 *     testable without Nest, Prisma or storage.
 */

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

/** Escape text for use in HTML element content and quoted attribute values. */
export function escapeHtml(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return text.replace(/[&<>"'`]/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * Display text for one decrypted field value. Objects and arrays (not produced
 * by the current field types, but possible in old data) are shown as JSON
 * rather than `[object Object]`.
 */
export function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

const STYLES = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 16px 48px; font: 15px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f6f7f9; color: #1d2330; }
main { max-width: 960px; margin: 0 auto; }
h1 { font-size: 1.6rem; margin: 0 0 4px; }
h2 { font-size: 1.25rem; margin: 0 0 4px; word-break: break-word; }
h3 { font-size: 1rem; margin: 20px 0 8px; }
.meta { color: #5b6475; font-size: 0.875rem; }
.summary, .secret { background: #fff; border: 1px solid #dde1e8; border-radius: 10px; padding: 16px 20px; margin: 16px 0; }
.warnings { background: #fff7e6; border: 1px solid #f0c36d; border-radius: 10px; padding: 12px 20px; margin: 16px 0; }
.toc ol { margin: 8px 0 0; padding-left: 24px; }
.toc a { color: inherit; }
.description { margin: 8px 0 0; white-space: pre-wrap; word-break: break-word; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th, td { text-align: left; vertical-align: top; padding: 6px 8px; border-bottom: 1px solid #eceef2; }
th { width: 34%; font-weight: 600; color: #3b4354; }
td { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; word-break: break-all; }
.empty { color: #8a93a5; font-style: italic; font-family: inherit; }
.attachments { list-style: none; padding: 0; margin: 8px 0 0; }
.attachments li { margin: 0 0 12px; }
.attachments img { display: block; max-width: 100%; max-height: 360px; margin-top: 6px; border: 1px solid #dde1e8; border-radius: 6px; }
.missing { color: #a33a1f; }
details { margin-top: 16px; border-top: 1px dashed #dde1e8; padding-top: 12px; }
summary { cursor: pointer; font-weight: 600; }
.version { margin: 12px 0 0 12px; padding-left: 12px; border-left: 3px solid #dde1e8; }
@media (prefers-color-scheme: dark) {
  body { background: #12151b; color: #e4e7ee; }
  .summary, .secret { background: #1b1f27; border-color: #2c3240; }
  .warnings { background: #2e2512; border-color: #6b5320; }
  th { color: #c3c9d6; }
  th, td { border-bottom-color: #2c3240; }
  .meta { color: #9aa3b5; }
  .missing { color: #ff8a6b; }
  .attachments img { border-color: #2c3240; }
  details, .version { border-color: #2c3240; }
}
@media print {
  body { background: #fff; padding: 0; }
  .secret { break-inside: avoid; }
}
`;

function secretAnchor(index: number): string {
  return `secret-${index + 1}`;
}

function renderFieldTable(
  fields: ExportFieldDefinition[],
  data: Record<string, unknown>,
): string {
  const rows: string[] = [];
  const known = new Set<string>();

  for (const field of fields) {
    known.add(field.name);
    rows.push(renderFieldRow(field.label || field.name, data[field.name]));
  }

  // Values whose field was later removed from the type are still the user's
  // data, so they are shown (under their raw key) rather than dropped.
  for (const key of Object.keys(data)) {
    if (!known.has(key)) {
      rows.push(renderFieldRow(key, data[key]));
    }
  }

  if (rows.length === 0) {
    return '<p class="empty">No fields.</p>';
  }

  return `<table><tbody>${rows.join('')}</tbody></table>`;
}

function renderFieldRow(label: string, value: unknown): string {
  const text = formatFieldValue(value);
  const cell = text === '' ? '<span class="empty">(empty)</span>' : escapeHtml(text);
  return `<tr><th scope="row">${escapeHtml(label)}</th><td>${cell}</td></tr>`;
}

function attachmentTitle(attachment: ExportAttachmentEntry): string {
  const parts: string[] = [];
  if (attachment.label) {
    parts.push(attachment.label);
  } else if (attachment.role === 'card_front') {
    parts.push('Card front');
  } else if (attachment.role === 'card_back') {
    parts.push('Card back');
  }
  parts.push(attachment.originalName || 'file');
  return parts.join(' - ');
}

function renderAttachments(attachments: ExportAttachmentEntry[]): string {
  if (attachments.length === 0) {
    return '';
  }

  const items = attachments.map((attachment) => {
    const title = escapeHtml(attachmentTitle(attachment));
    const detail = `<span class="meta">${escapeHtml(attachment.mimeType)}, ${escapeHtml(
      formatBytes(attachment.size),
    )}</span>`;

    if (!attachment.file) {
      return `<li>${title} ${detail}<br><span class="missing">Not included: this file could not be read from storage.</span></li>`;
    }

    const href = escapeHtml(attachment.file);
    const image = isBrowserRenderableImage(attachment.mimeType)
      ? `<a href="${href}"><img src="${href}" alt="${title}" loading="lazy"></a>`
      : '';
    return `<li><a href="${href}">${title}</a> ${detail}${image}</li>`;
  });

  return `<h3>Attachments</h3><ul class="attachments">${items.join('')}</ul>`;
}

function renderVersionBody(
  fields: ExportFieldDefinition[],
  version: ExportVersionEntry,
): string {
  return renderFieldTable(fields, version.data) + renderAttachments(version.attachments);
}

function renderOldVersions(secret: ExportSecretEntry): string {
  if (!secret.versions) {
    return '';
  }

  const currentId = secret.current?.versionId;
  // Newest first reads more naturally in a history list; secrets.json keeps
  // the documented oldest-first order.
  const older = secret.versions
    .filter((version) => version.versionId !== currentId)
    .slice()
    .reverse();

  if (older.length === 0) {
    return '';
  }

  const blocks = older.map(
    (version) =>
      `<div class="version"><h3>Version ${escapeHtml(version.versionNumber)}</h3>` +
      `<div class="meta">Created ${escapeHtml(version.createdAt)}</div>` +
      renderVersionBody(secret.type.fields, version) +
      '</div>',
  );

  return (
    `<details><summary>Previous versions (${older.length})</summary>` +
    blocks.join('') +
    '</details>'
  );
}

function renderSecret(secret: ExportSecretEntry, index: number): string {
  const current = secret.current;
  const versionLine = current
    ? ` &middot; Version ${escapeHtml(current.versionNumber)}`
    : '';
  const description = secret.description
    ? `<p class="description">${escapeHtml(secret.description)}</p>`
    : '';
  const body = current
    ? renderVersionBody(secret.type.fields, current)
    : '<p class="empty">This secret has no stored values.</p>';

  return (
    `<section class="secret" id="${secretAnchor(index)}">` +
    `<h2>${escapeHtml(secret.name)}</h2>` +
    `<div class="meta">${escapeHtml(secret.type.name)}${versionLine}` +
    ` &middot; Created ${escapeHtml(secret.createdAt)}` +
    ` &middot; Updated ${escapeHtml(secret.updatedAt)}</div>` +
    description +
    body +
    renderOldVersions(secret) +
    '</section>'
  );
}

/** Human-readable byte size (`0 B`, `12.3 KB`, `4.0 MB`). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}

/** Render the complete `secrets.html` document for a manifest. */
export function renderSecretsHtml(manifest: SecretsExportManifest): string {
  const toc =
    manifest.secrets.length > 0
      ? `<nav class="summary toc"><strong>Contents</strong><ol>${manifest.secrets
          .map(
            (secret, index) =>
              `<li><a href="#${secretAnchor(index)}">${escapeHtml(secret.name)}</a></li>`,
          )
          .join('')}</ol></nav>`
      : '';

  const warnings =
    manifest.warnings.length > 0
      ? `<div class="warnings"><strong>Warnings</strong><ul>${manifest.warnings
          .map((warning) => `<li>${escapeHtml(warning)}</li>`)
          .join('')}</ul></div>`
      : '';

  const sections =
    manifest.secrets.length > 0
      ? manifest.secrets.map((secret, index) => renderSecret(secret, index)).join('')
      : '<div class="summary"><p class="empty">This backup contains no secrets.</p></div>';

  const options = [
    manifest.options.includeAttachments ? 'attachments included' : 'attachments excluded',
    manifest.options.includeVersions ? 'all versions' : 'current versions only',
  ].join(', ');

  return (
    '<!DOCTYPE html>\n' +
    '<html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">` +
    '<meta name="referrer" content="no-referrer">' +
    '<title>Vault backup</title>' +
    `<style>${STYLES}</style></head><body><main>` +
    '<h1>Vault backup</h1>' +
    `<div class="meta">Exported ${escapeHtml(manifest.exportedAt)} for ${escapeHtml(
      manifest.owner.email,
    )}</div>` +
    `<div class="summary">${escapeHtml(manifest.counts.secrets)} secret(s), ` +
    `${escapeHtml(manifest.counts.attachments)} attachment file(s); ${escapeHtml(options)}.` +
    '<br><span class="meta">Keep this file private: everything below is unencrypted once the zip is opened.</span></div>' +
    warnings +
    toc +
    sections +
    '</main></body></html>\n'
  );
}
