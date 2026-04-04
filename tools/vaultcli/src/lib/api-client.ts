import { config } from '../utils/config.js';
import { loadAuth } from './auth-store.js';
import type {
  HealthResponse,
  PaginatedResponse,
  Secret,
  SecretListItem,
  SecretType,
  SecretVersion,
  UserInfo,
} from '../utils/types.js';

function getToken(): string {
  const auth = loadAuth();
  if (!auth) {
    throw new Error('Not authenticated. Run: vaultcli auth login');
  }
  return auth.token;
}

export interface ApiRequestOptions extends RequestInit {
  requireAuth?: boolean;
}

export async function apiRequest(
  path: string,
  options: ApiRequestOptions = {},
): Promise<Response> {
  const { requireAuth = true, ...fetchOptions } = options;
  const url = `${config.apiUrl}${path}`;
  const headers: Record<string, string> = {
    ...(fetchOptions.headers as Record<string, string>),
  };

  if (requireAuth) {
    headers['Authorization'] = `Bearer ${getToken()}`;
  }

  if (fetchOptions.body && typeof fetchOptions.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, { ...fetchOptions, headers });

  if (response.status === 401 && requireAuth) {
    throw new Error('Authentication failed. Your token may be expired or revoked. Run: vaultcli auth login');
  }

  return response;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function getCurrentUser(): Promise<UserInfo> {
  const res = await apiRequest('/auth/me');
  if (!res.ok) throw new Error('Failed to get user info');
  const json = (await res.json()) as { data: UserInfo };
  return json.data;
}

export async function validateToken(token: string): Promise<UserInfo> {
  const url = `${config.apiUrl}/auth/me`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Invalid token');
  const json = (await res.json()) as { data: UserInfo };
  return json.data;
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

export async function listSecrets(params: {
  page?: number;
  pageSize?: number;
  typeId?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
}): Promise<PaginatedResponse<SecretListItem>> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.typeId) query.set('typeId', params.typeId);
  if (params.search) query.set('search', params.search);
  if (params.sortBy) query.set('sortBy', params.sortBy);
  if (params.sortOrder) query.set('sortOrder', params.sortOrder);

  const qs = query.toString();
  const res = await apiRequest(`/secrets${qs ? '?' + qs : ''}`);
  if (!res.ok) throw new Error(`Failed to list secrets: ${res.status}`);
  const json = (await res.json()) as { data: PaginatedResponse<SecretListItem> };
  return json.data;
}

export async function getSecret(id: string): Promise<Secret> {
  const res = await apiRequest(`/secrets/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to get secret: ${res.status}`);
  const json = (await res.json()) as { data: Secret };
  return json.data;
}

export async function getSecretByName(name: string): Promise<Secret> {
  const res = await apiRequest(`/secrets/by-name/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`Failed to get secret: ${res.status}`);
  const json = (await res.json()) as { data: Secret };
  return json.data;
}

/**
 * Resolve an ID-or-name argument to a Secret.
 * If the argument looks like a UUID, fetch by ID; otherwise fetch by name.
 */
export async function resolveSecret(idOrName: string): Promise<Secret> {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (UUID_RE.test(idOrName)) {
    return getSecret(idOrName);
  }
  return getSecretByName(idOrName);
}

export async function createSecret(dto: {
  name: string;
  typeId: string;
  description?: string;
  data: Record<string, unknown>;
}): Promise<Secret> {
  const res = await apiRequest('/secrets', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create secret: ${res.status} ${body}`);
  }
  const json = (await res.json()) as { data: Secret };
  return json.data;
}

export async function updateSecret(
  id: string,
  dto: { name?: string; description?: string; data?: Record<string, unknown> },
): Promise<Secret> {
  const res = await apiRequest(`/secrets/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(dto),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to update secret: ${res.status} ${body}`);
  }
  const json = (await res.json()) as { data: Secret };
  return json.data;
}

export async function deleteSecret(id: string): Promise<void> {
  const res = await apiRequest(`/secrets/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete secret: ${res.status}`);
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export async function listVersions(secretId: string): Promise<SecretVersion[]> {
  const res = await apiRequest(`/secrets/${encodeURIComponent(secretId)}/versions`);
  if (!res.ok) throw new Error(`Failed to list versions: ${res.status}`);
  const json = (await res.json()) as { data: SecretVersion[] };
  return json.data;
}

export async function getVersion(secretId: string, versionId: string): Promise<SecretVersion> {
  const res = await apiRequest(
    `/secrets/${encodeURIComponent(secretId)}/versions/${encodeURIComponent(versionId)}`,
  );
  if (!res.ok) throw new Error(`Failed to get version: ${res.status}`);
  const json = (await res.json()) as { data: SecretVersion };
  return json.data;
}

export async function rollbackVersion(secretId: string, versionId: string): Promise<Secret> {
  const res = await apiRequest(
    `/secrets/${encodeURIComponent(secretId)}/versions/${encodeURIComponent(versionId)}/rollback`,
    { method: 'POST' },
  );
  if (!res.ok) throw new Error(`Failed to rollback: ${res.status}`);
  const json = (await res.json()) as { data: Secret };
  return json.data;
}

// ---------------------------------------------------------------------------
// Secret Types
// ---------------------------------------------------------------------------

export async function listSecretTypes(params?: {
  search?: string;
}): Promise<SecretType[]> {
  const query = new URLSearchParams();
  if (params?.search) query.set('search', params.search);

  const qs = query.toString();
  const res = await apiRequest(`/secret-types${qs ? '?' + qs : ''}`);
  if (!res.ok) throw new Error(`Failed to list secret types: ${res.status}`);
  const json = (await res.json()) as { data: SecretType[] };
  return json.data;
}

export async function getSecretType(id: string): Promise<SecretType> {
  const res = await apiRequest(`/secret-types/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to get secret type: ${res.status}`);
  const json = (await res.json()) as { data: SecretType };
  return json.data;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export async function healthLive(): Promise<HealthResponse> {
  const res = await apiRequest('/health/live', { requireAuth: false });
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return (await res.json()) as HealthResponse;
}

export async function healthReady(): Promise<HealthResponse> {
  const res = await apiRequest('/health/ready', { requireAuth: false });
  if (!res.ok) throw new Error(`Readiness check failed: ${res.status}`);
  return (await res.json()) as HealthResponse;
}
