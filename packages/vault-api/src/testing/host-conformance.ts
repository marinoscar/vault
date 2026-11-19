import type { INestApplication } from '@nestjs/common';

import { VAULT_RESERVED_NAMES, findVaultNameCollisions, type VaultHostNames } from '../core/names';

// =============================================================================
// runVaultHostConformance: the host conformance kit (issue #194, epic #191)
// =============================================================================
//
// What a host that mounts `VaultApiModule.forRoot` runs against ITS OWN bindings, its own database
// and its own identity, over HTTP: a login is created, versioned and rolled back, a document gets
// an attachment, another user cannot see either, the login is opened to agents and an agent looks it
// up and fills it through `/api/agent/v1`. It is built from the second-host fixture's smoke suite
// (`tests/second-host/`), which runs it in CI against a real PostgreSQL.
//
// It registers one `describe` block; call it at the top level of a spec file, with getters for what
// the spec builds in its `beforeAll` (the app, the users, the tokens).
// =============================================================================

/** One signed-in user of the host. */
export interface VaultHostConformanceUser {
  /** A browser-session access token (`Authorization: Bearer`). */
  session: string;
}

/** The owner: a user who holds `secrets:read|write|delete|fill` through the host's roles. */
export interface VaultHostConformanceOwner extends VaultHostConformanceUser {
  /** The owner's user id. */
  id: string;
  /** A token the agent API accepts for the owner: a personal access token (`pat_`) or an OAuth token (`oat_`). */
  agentToken: string;
}

/** A request the kit makes; the default goes through Fastify's `inject` (no socket). */
export type VaultHostRequest = (request: {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}) => Promise<{ status: number; body: any; headers: Record<string, unknown> }>;

/** The globals the kit registers its tests with. */
export interface VaultHostConformanceTestApi {
  describe: (name: string, fn: () => void) => void;
  it: (name: string, fn: () => Promise<void> | void, timeout?: number) => void;
  expect: (value: unknown) => any;
}

/** A minimal OpenAPI document: the paths with their operation ids and tags. */
export interface VaultHostOpenApiDocument {
  paths: Record<string, Record<string, { operationId?: string; tags?: string[] } | unknown>>;
}

/**
 * Options of {@link runVaultHostConformance}.
 *
 * @stability experimental
 */
export interface VaultHostConformanceOptions {
  /** The booted host application (`app.init()` done), read lazily. */
  app: () => INestApplication;
  /** The owner of the secrets the kit creates. */
  owner: () => VaultHostConformanceOwner;
  /** A second user of the same organization, who must see none of the owner's secrets. */
  other: () => VaultHostConformanceUser;
  /**
   * Makes a storage object the owner uploaded (status `ready`, in the owner's organization, its
   * bytes in the object store the host bound to `VAULT_OBJECT_STORE`) and returns its id. The
   * platform's storage slice does this for an upload; a host without it inserts the row itself.
   */
  createStorageObject: (owner: VaultHostConformanceOwner) => Promise<string>;
  /** The audit actions written since the app booted (read from the host's audit trail); checked when given. */
  readAuditActions?: () => Promise<string[]>;
  /** The host's own names, checked against the names the packages reserve. */
  hostNames?: () => VaultHostNames;
  /** The host's OpenAPI document (`SwaggerModule.createDocument`), checked when given. */
  openApiDocument?: () => VaultHostOpenApiDocument;
  /** The global prefix. Default `/api`. */
  apiPrefix?: string;
  /** The website origin of the test login. Default `https://shop.example.test`. */
  origin?: string;
  /** Overrides the transport; default Fastify `inject`. */
  request?: VaultHostRequest;
  /** Default: the globals `describe`, `it`, `expect` (Jest, or Vitest with `globals: true`). */
  testApi?: VaultHostConformanceTestApi;
}

function fastifyRequest(app: () => INestApplication): VaultHostRequest {
  return async ({ method, url, headers, body }) => {
    const instance = app().getHttpAdapter().getInstance() as {
      inject?: (opts: unknown) => Promise<{ statusCode: number; body: string; headers: Record<string, unknown> }>;
    };
    if (typeof instance.inject !== 'function') {
      throw new Error('runVaultHostConformance: the app is not on Fastify; pass `request`');
    }
    const res = await instance.inject({
      method,
      url,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
    let parsed: unknown = res.body;
    try {
      parsed = res.body.length > 0 ? JSON.parse(res.body) : undefined;
    } catch {
      // not JSON: keep the text
    }
    return { status: res.statusCode, body: parsed, headers: res.headers };
  };
}

function defaultTestApi(): VaultHostConformanceTestApi {
  const g = globalThis as unknown as Partial<VaultHostConformanceTestApi>;
  if (!g.describe || !g.it || !g.expect) {
    throw new Error('runVaultHostConformance: no describe/it/expect globals; pass `testApi`');
  }
  return { describe: g.describe, it: g.it, expect: g.expect };
}

/** The fixed values of the smoke run. Invented placeholders only. */
const LOGIN = { username: 'person-a@example.test', password: 'HostConformance-Pw-1', rotated: 'HostConformance-Pw-2' };

/**
 * Registers the host conformance suite: the Vault packages, mounted in THIS host with THESE
 * bindings, behave as they do in Vault. The suite needs:
 *
 * - the `agentAccess` settings namespace with `enabled: true` (the agent API ships off);
 * - the system secret types (`seedVaultSystemSecretTypes`);
 * - an owner with `secrets:read|write|delete|fill` and a second user of the same organization.
 *
 * @param options - see {@link VaultHostConformanceOptions}.
 *
 * @example
 * ```ts
 * runVaultHostConformance({
 *   app: () => app,
 *   owner: () => owner,
 *   other: () => other,
 *   createStorageObject: (user) => insertReadyObject(prisma, user.id),
 * });
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export function runVaultHostConformance(options: VaultHostConformanceOptions): void {
  const { describe, it, expect } = options.testApi ?? defaultTestApi();
  const prefix = (options.apiPrefix ?? '/api').replace(/\/+$/, '');
  const origin = options.origin ?? 'https://shop.example.test';
  const send = options.request ?? fastifyRequest(options.app);
  const call = (method: Parameters<VaultHostRequest>[0]['method'], path: string, token: string, body?: unknown) =>
    send({ method, url: `${prefix}${path}`, headers: { authorization: `Bearer ${token}` }, body });

  const state = { credentialTypeId: '', documentTypeId: '', loginId: '', firstVersionId: '', documentId: '' };

  describe('Vault host conformance', () => {
    if (options.hostNames) {
      it("reserves the packages' names: none of the host's own names collides", () => {
        expect(findVaultNameCollisions(options.hostNames!())).toEqual([]);
      });
    }

    if (options.openApiDocument) {
      it('documents the Vault routes with operation ids unique across the host', () => {
        const doc = options.openApiDocument!();
        const ids: string[] = [];
        for (const operations of Object.values(doc.paths)) {
          for (const operation of Object.values(operations)) {
            const id = (operation as { operationId?: string } | null)?.operationId;
            if (id) ids.push(id);
          }
        }
        expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
        const paths = Object.keys(doc.paths);
        for (const routePrefix of VAULT_RESERVED_NAMES.routePrefixes) {
          expect({ routePrefix, documented: paths.some((p) => p === `${prefix}${routePrefix}` || p.startsWith(`${prefix}${routePrefix}/`)) }).toEqual({
            routePrefix,
            documented: true,
          });
        }
      });
    }

    it('serves the system secret types', async () => {
      const res = await call('GET', '/secret-types', options.owner().session);
      expect(res.status).toBe(200);
      const types = (res.body?.data ?? []) as Array<{ id: string; name: string; isSystem: boolean }>;
      state.credentialTypeId = types.find((t) => t.name === 'Credential' && t.isSystem)?.id ?? '';
      state.documentTypeId = types.find((t) => t.name === 'Document' && t.isSystem)?.id ?? '';
      expect({ credential: Boolean(state.credentialTypeId), document: Boolean(state.documentTypeId) }).toEqual({ credential: true, document: true });
    });

    it('creates a login, encrypted through the host cipher', async () => {
      const res = await call('POST', '/secrets', options.owner().session, {
        name: 'Shop login',
        typeId: state.credentialTypeId,
        data: { username: LOGIN.username, password: LOGIN.password, url: origin },
      });
      expect(res.status).toBe(201);
      state.loginId = res.body.data.id;
      const detail = await call('GET', `/secrets/${state.loginId}`, options.owner().session);
      expect(detail.status).toBe(200);
      expect(detail.body.data.values).toMatchObject({ username: LOGIN.username, password: LOGIN.password });
    });

    it('mints a new version when the data changes', async () => {
      const update = await call('PUT', `/secrets/${state.loginId}`, options.owner().session, {
        data: { username: LOGIN.username, password: LOGIN.rotated, url: origin },
      });
      expect(update.status).toBe(200);
      const versions = await call('GET', `/secrets/${state.loginId}/versions`, options.owner().session);
      expect(versions.status).toBe(200);
      const list = versions.body.data as Array<{ id: string; versionNumber?: number; isCurrent: boolean }>;
      expect(list).toHaveLength(2);
      state.firstVersionId = list.find((v) => !v.isCurrent)!.id;
    });

    it('rolls back to the first version as a new current version', async () => {
      const res = await call('POST', `/secrets/${state.loginId}/versions/${state.firstVersionId}/rollback`, options.owner().session);
      expect([200, 201]).toContain(res.status);
      const detail = await call('GET', `/secrets/${state.loginId}`, options.owner().session);
      expect(detail.body.data.values).toMatchObject({ password: LOGIN.password });
      const versions = await call('GET', `/secrets/${state.loginId}/versions`, options.owner().session);
      const list = versions.body.data as Array<{ isCurrent: boolean }>;
      expect({ versions: list.length, current: list.filter((v) => v.isCurrent).length }).toEqual({ versions: 3, current: 1 });
    });

    it('links an attachment to a document', async () => {
      const created = await call('POST', '/secrets', options.owner().session, {
        name: 'Lease',
        typeId: state.documentTypeId,
        data: { title: 'Lease agreement' },
      });
      expect(created.status).toBe(201);
      state.documentId = created.body.data.id;
      const storageObjectId = await options.createStorageObject(options.owner());
      const linked = await call('POST', `/secrets/${state.documentId}/attachments`, options.owner().session, { storageObjectId });
      expect(linked.status).toBe(201);
      const list = await call('GET', `/secrets/${state.documentId}/attachments`, options.owner().session);
      expect(list.status).toBe(200);
      expect((list.body.data as unknown[]).length).toBe(1);
    });

    it("keeps one user's secrets from another", async () => {
      for (const id of [state.loginId, state.documentId]) {
        const res = await call('GET', `/secrets/${id}`, options.other().session);
        expect([403, 404]).toContain(res.status);
        expect(JSON.stringify(res.body ?? '')).not.toContain(LOGIN.password);
      }
      const list = await call('GET', '/secrets', options.other().session);
      expect(list.status).toBe(200);
      expect(JSON.stringify(list.body)).not.toContain(state.loginId);
    });

    it('opens the login to agents', async () => {
      const res = await call('PATCH', `/secrets/${state.loginId}/agent-access`, options.owner().session, { agentAccess: 'fill' });
      expect(res.status).toBe(200);
    });

    it('looks the login up through /agent/v1 without a sensitive value', async () => {
      const res = await call('GET', `/agent/v1/credentials?origin=${encodeURIComponent(origin)}`, options.owner().agentToken);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toContain('no-store');
      const found = res.body.data as Array<{ id: string; username: string }>;
      expect(found.map((c) => [c.id, c.username])).toEqual([[state.loginId, LOGIN.username]]);
      expect(JSON.stringify(res.body)).not.toContain(LOGIN.password);
    });

    it('fills one field through /agent/v1, for the exact origin only', async () => {
      const fill = await call('POST', `/agent/v1/credentials/${state.loginId}/fill`, options.owner().agentToken, {
        field: 'password',
        origin,
        purpose: 'login',
      });
      expect(fill.status).toBe(200);
      expect(fill.body.data.value).toBe(LOGIN.password);
      const elsewhere = await call('POST', `/agent/v1/credentials/${state.loginId}/fill`, options.owner().agentToken, {
        field: 'password',
        origin: 'https://elsewhere.example.test',
        purpose: 'login',
      });
      expect(elsewhere.status).toBe(403);
    });

    it('refuses a browser session on the agent API', async () => {
      const res = await call('GET', `/agent/v1/credentials?origin=${encodeURIComponent(origin)}`, options.owner().session);
      expect(res.status).toBe(403);
    });

    if (options.readAuditActions) {
      it('audits the run under the reserved action names', async () => {
        const actions = await options.readAuditActions!();
        for (const expected of ['secret.create', 'secret.update', 'secret.rollback', 'secret.attachment.link', 'secret.agent_access.update', 'agent.credential.fill']) {
          expect(actions).toContain(expected);
        }
        const vaultActions = actions.filter((a) => VAULT_RESERVED_NAMES.auditActionPrefixes.some((p) => a.startsWith(p)));
        expect(vaultActions.length).toBeGreaterThan(0);
      });
    }
  });
}
