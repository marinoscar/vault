/**
 * Shapes of the vault backup archive (formatVersion 1).
 *
 * `SecretsExportManifest` is exactly what is written to `secrets.json`, and is
 * also the only input of the HTML and README renderers, so the readable report
 * can never show something the machine-readable file does not contain.
 */

export const EXPORT_FORMAT_VERSION = 1;

/** Folder inside the zip that holds every attachment blob. */
export const EXPORT_ATTACHMENTS_DIR = 'attachments';

export interface ExportFieldDefinition {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  sensitive?: boolean;
  options?: string[];
}

export interface ExportAttachmentEntry {
  /**
   * Path of the blob inside the zip (e.g. `attachments/0001-01.jpg`), or
   * `null` when the blob could not be read from storage and was skipped; the
   * reason is in the manifest's `warnings`.
   */
  file: string | null;
  role: string | null;
  label: string | null;
  originalName: string;
  mimeType: string;
  size: number;
}

export interface ExportVersionEntry {
  versionId: string;
  versionNumber: number;
  createdAt: string;
  data: Record<string, unknown>;
  attachments: ExportAttachmentEntry[];
}

export interface ExportSecretEntry {
  id: string;
  name: string;
  description: string | null;
  type: {
    id: string;
    name: string;
    fields: ExportFieldDefinition[];
  };
  createdAt: string;
  updatedAt: string;
  /** `null` only for a secret that has no version at all (not normally possible). */
  current: ExportVersionEntry | null;
  /** Every version, oldest first. Present only when `includeVersions` is true. */
  versions?: ExportVersionEntry[];
}

export interface SecretsExportManifest {
  formatVersion: typeof EXPORT_FORMAT_VERSION;
  exportedAt: string;
  app: 'vault';
  owner: { id: string; email: string };
  /**
   * What the archive was asked to contain. `includeSecrets` is always true in
   * a `secrets.json` (the file is only written when secrets are selected);
   * `includeMedia` says whether `media/` is next to it.
   */
  options: {
    includeSecrets: boolean;
    includeAttachments: boolean;
    includeVersions: boolean;
    includeMedia: boolean;
  };
  counts: { secrets: number; attachments: number };
  warnings: string[];
  secrets: ExportSecretEntry[];
}
