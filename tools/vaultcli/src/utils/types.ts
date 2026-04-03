export type OutputMode = 'human' | 'json' | 'quiet';

export interface CliResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface GlobalOptions {
  json?: boolean;
  quiet?: boolean;
  server?: string;
  color?: boolean;
  verbose?: boolean;
}

export interface AuthData {
  token: string;
  serverUrl: string;
}

export interface UserInfo {
  id: string;
  email: string;
  displayName: string | null;
  profileImageUrl: string | null;
  isActive: boolean;
  isAdmin: boolean;
}

export interface Secret {
  id: string;
  name: string;
  description: string | null;
  typeId: string;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  currentVersion: number | null;
  type?: SecretType;
  values?: Record<string, unknown> | null;
  attachments?: SecretAttachment[];
}

export interface SecretListItem {
  id: string;
  name: string;
  description: string | null;
  typeId: string;
  createdAt: string;
  updatedAt: string;
  currentVersion: number | null;
  type?: SecretType;
}

export interface SecretVersion {
  id: string;
  version: number;
  isCurrent: boolean;
  createdAt: string;
  createdBy: {
    id: string;
    email: string;
    displayName: string | null;
  } | null;
  values?: Record<string, unknown>;
}

export interface FieldDefinition {
  name: string;
  label: string;
  type: 'string' | 'number' | 'date';
  required: boolean;
  sensitive: boolean;
}

export interface SecretType {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  fields: FieldDefinition[];
  allowAttachments: boolean;
  isSystem: boolean;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SecretAttachment {
  id: string;
  secretId: string;
  storageObjectId: string;
  label: string | null;
  createdAt: string;
  storageObject?: {
    id: string;
    name: string;
    size: string;
    mimeType: string;
    status: string;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  meta: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface HealthResponse {
  status: string;
  timestamp?: string;
  database?: string;
}
