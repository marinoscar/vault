import 'reflect-metadata';

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { ExecutionContext, RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AiEnabledGuard } from '@marinoscar/platform-api/ai';
import { JwtAuthGuard } from '@marinoscar/platform-api/identity';
import { AGENT_AUDIT_ACTIONS } from '@marinoscar/vault-contract/agent';

import { AgentActivityController, AgentController, VAULT_OAUTH_RESOURCES, VAULT_OAUTH_SCOPE_DEFINITIONS } from '../src/agent';
import { CardExtractController } from '../src/ai';
import { BackupNotifier, BackupsController, MyBackupsController } from '../src/backups';
import { CardExpiryScanHandler } from '../src/card-expiry';
import * as notificationData from '../src/core/notification-data';
import {
  VAULT_PERMISSIONS,
  VAULT_RESERVED_NAMES,
  findVaultNameCollisions,
  vaultPermissionDeclarations,
} from '../src/core';
import { McpController } from '../src/mcp';
import { VAULT_MCP_RESOURCES, VAULT_MCP_SCOPE_DEFINITIONS } from '../src/mcp/mcp-oauth';
import { MediaController } from '../src/media';
import { SecretTypesController } from '../src/secret-types';
import { SecretsController } from '../src/secrets';
import { VAULT_HOST } from '../src/ports';
import { createFakeBindings } from '../src/testing';
import { VaultApiModule, type VaultApiBindings } from '../src/vault-api.module';

// =============================================================================
// What a second host relies on (issue #194, epic #191)
// =============================================================================
//
// Every name the package puts into a host's shared registries, derived from the code and compared
// with `VAULT_RESERVED_NAMES` (so the inventory cannot go stale), the role mapping a host with its
// own roles uses, and the `VAULT_HOST` binding that replaced the package's reads of `APP_URL`.
// =============================================================================

const SRC = join(__dirname, '..', 'src');
const CONTRACT_SRC = join(__dirname, '..', '..', 'vault-contract', 'src');

const CONTROLLERS = [
  SecretTypesController,
  SecretsController,
  MediaController,
  CardExtractController,
  BackupsController,
  MyBackupsController,
  AgentController,
  AgentActivityController,
  McpController,
];

/** Every non-test TypeScript file under `dir`. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.ts$/.test(name) && !/\.(spec|test)\.ts$/.test(name) && !path.includes(`${join('src', 'testing')}`) ? [path] : [];
  });
}

const allSource = () => [...sources(SRC), ...sources(CONTRACT_SRC)].map((path) => ({ path, text: readFileSync(path, 'utf8') }));

function routesOf(controller: new (...args: never[]) => unknown): string[] {
  const base: string = Reflect.getMetadata('path', controller) ?? '';
  const proto = controller.prototype as unknown as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
    .flatMap((name) => {
      const method = Reflect.getMetadata('method', proto[name] as object);
      if (method === undefined) return [];
      const path: string = Reflect.getMetadata('path', proto[name] as object) ?? '/';
      return [`${RequestMethod[method]} /${[base, path].map((p) => p.replace(/^\/|\/$/g, '')).filter(Boolean).join('/')}`];
    });
}

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
const allow = { canActivate: (_ctx: ExecutionContext) => true };

describe('the names the packages put into a host', () => {
  it('serves every route under a reserved prefix, and every reserved prefix serves a route', () => {
    const paths = CONTROLLERS.flatMap(routesOf).map((route) => route.split(' ')[1]!);
    const outside = paths.filter((path) => !VAULT_RESERVED_NAMES.routePrefixes.some((prefix) => under(path, prefix)));
    expect(outside).toEqual([]);
    const unused = VAULT_RESERVED_NAMES.routePrefixes.filter((prefix) => !paths.some((path) => under(path, prefix)));
    expect(unused).toEqual([]);
  });

  it('declares every permission on a reserved resource', () => {
    const resources = new Set(Object.values(VAULT_PERMISSIONS).map((p) => p.id.split(':')[0]));
    expect([...resources].sort()).toEqual([...VAULT_RESERVED_NAMES.permissionResources].sort());
  });

  it('reads only reserved settings namespaces (and the platform AI slice’s `ai`)', () => {
    const read = new Set<string>();
    for (const { text } of allSource()) {
      for (const match of text.matchAll(/getNamespace(?:<[^>]*>)?\(\s*'([A-Za-z0-9_]+)'/g)) read.add(match[1]!);
    }
    expect(read.size).toBeGreaterThan(0);
    expect([...read].filter((ns) => ns !== 'ai' && !(VAULT_RESERVED_NAMES.settingsNamespaces as readonly string[]).includes(ns))).toEqual([]);
  });

  it('registers every job type under `vault.`', async () => {
    const fake = createFakeBindings();
    const moduleRef = await Test.createTestingModule({ imports: [VaultApiModule.forRoot({ bindings: fake.bindings })] })
      .overrideGuard(JwtAuthGuard)
      .useValue(allow)
      .overrideGuard(AiEnabledGuard)
      .useValue(allow)
      .compile();
    await moduleRef.init();
    const types = [...fake.ports.jobs.handlers.keys()];
    await moduleRef.close();
    expect(types.length).toBeGreaterThan(0);
    expect(types.filter((type) => !type.startsWith(VAULT_RESERVED_NAMES.jobTypePrefix))).toEqual([]);
  });

  it('keys every notification event under `vault.` and every email template under `vault-`', () => {
    const entries = Object.entries(notificationData).filter(([, value]) => typeof value === 'string') as Array<[string, string]>;
    const events = entries.filter(([key]) => key.endsWith('_EVENT')).map(([, value]) => value);
    const templates = entries.filter(([key]) => key.endsWith('_TEMPLATE')).map(([, value]) => value);
    expect(events.length).toBeGreaterThan(0);
    expect(templates.length).toBeGreaterThan(0);
    expect(events.filter((event) => !event.startsWith(VAULT_RESERVED_NAMES.notificationEventPrefix))).toEqual([]);
    expect(templates.filter((template) => !template.startsWith(VAULT_RESERVED_NAMES.emailTemplatePrefix))).toEqual([]);
    // No event or template is declared anywhere else in the package.
    for (const { path, text } of allSource()) {
      if (path.endsWith(join('core', 'notification-data.ts'))) continue;
      for (const match of text.matchAll(/_(?:EVENT|TEMPLATE)\s*=\s*'([^']+)'/g)) {
        expect({ path, name: match[1], namespaced: /^vault[.-]/.test(match[1]!) }).toEqual({ path, name: match[1], namespaced: true });
      }
    }
  });

  it('writes every audit action under a reserved prefix', () => {
    const actions = new Set<string>(Object.values(AGENT_AUDIT_ACTIONS));
    for (const { text } of allSource()) {
      const patterns = [
        /\b(?:action|auditAction)\s*:\s*'([a-z_]+(?:\.[a-z_]+)+)'/g,
        /_AUDIT_ACTION\s*=\s*'([^']+)'/g,
        /_AUDIT_ACTIONS\s*=\s*\{([^}]*)\}/g,
        /(?:createAuditEvent|audit)\(\s*[\w.]+\s*,\s*'([a-z_]+(?:\.[a-z_]+)+)'/g,
      ];
      for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
          const body = match[1]!;
          if (body.includes(':')) for (const inner of body.matchAll(/'([a-z_.]+)'/g)) actions.add(inner[1]!);
          else actions.add(body);
        }
      }
    }
    expect(actions.size).toBeGreaterThan(15);
    expect([...actions].filter((a) => !VAULT_RESERVED_NAMES.auditActionPrefixes.some((p) => a.startsWith(p))).sort()).toEqual([]);
    for (const prefix of VAULT_RESERVED_NAMES.auditActionPrefixes) {
      expect({ prefix, used: [...actions].some((a) => a.startsWith(prefix)) }).toEqual({ prefix, used: true });
    }
  });

  it('names every OAuth scope `vault:*` and every protected resource as reserved', () => {
    const scopes = [...VAULT_OAUTH_SCOPE_DEFINITIONS, ...VAULT_MCP_SCOPE_DEFINITIONS].map((s) => s.id);
    expect(scopes.filter((id) => !id.startsWith(VAULT_RESERVED_NAMES.oauthScopePrefix))).toEqual([]);
    expect([...VAULT_OAUTH_RESOURCES, ...VAULT_MCP_RESOURCES].map((r) => r.id).sort()).toEqual([...VAULT_RESERVED_NAMES.oauthResources].sort());
  });

  it('tags every controller with a reserved OpenAPI tag', () => {
    const tags = new Set(CONTROLLERS.flatMap((c) => (Reflect.getMetadata('swagger/apiUseTags', c) as string[] | undefined) ?? []));
    expect([...tags].sort()).toEqual([...VAULT_RESERVED_NAMES.openApiTags].sort());
  });

  it('names no metric (the host names the instruments behind VAULT_METRICS)', () => {
    for (const { path, text } of allSource()) {
      expect({ path, metricNames: [...text.matchAll(/'app\.[a-z_]+\.[a-z_.]+'/g)].map((m) => m[0]) }).toEqual({ path, metricNames: [] });
    }
    expect(VAULT_RESERVED_NAMES.metricNames).toEqual([]);
  });
});

describe('findVaultNameCollisions', () => {
  it('finds nothing for a host that keeps to its own names', () => {
    expect(
      findVaultNameCollisions({
        routes: ['/beta/notes', '/secretsauce', '/mediation'],
        permissions: ['beta_notes:read'],
        settingsNamespaces: ['betaNotes'],
        jobTypes: ['beta.notes.archive'],
        notificationEvents: ['beta.note_shared'],
        emailTemplates: ['beta-note-shared'],
        auditActions: ['beta.note.create', 'secretary.update'],
        openApiTags: ['Beta notes'],
        metricNames: ['app.beta.notes.created'],
      }),
    ).toEqual([]);
  });

  it('names each collision', () => {
    expect(
      findVaultNameCollisions({
        routes: ['/secrets/archive', 'agent/v1'],
        permissions: ['media:read', 'vault_x:read'],
        settingsNamespaces: ['agentAccess', 'vaultExtra'],
        jobTypes: ['vault.beta'],
        notificationEvents: ['vault.beta'],
        emailTemplates: ['vault-beta'],
        auditActions: ['agent.credential.read', 'secret.create'],
        openApiTags: ['Secrets'],
        metricNames: ['app.vault.beta'],
      }),
    ).toHaveLength(13);
  });
});

describe('vaultPermissionDeclarations (a host with its own roles)', () => {
  it("is Vault's declaration map itself without a mapping", () => {
    expect(vaultPermissionDeclarations()).toBe(VAULT_PERMISSIONS);
  });

  it('maps the default grants onto host roles and keeps ids, descriptions and scopes', () => {
    const mapped = vaultPermissionDeclarations({ contributor: ['beta_editor'], viewer: ['beta_reader'], org_admin: ['org_admin', 'beta_owner'] });
    expect(mapped.SECRETS_WRITE).toEqual({ ...VAULT_PERMISSIONS.SECRETS_WRITE, defaultGrants: ['org_admin', 'beta_owner', 'beta_editor'] });
    expect(mapped.SECRETS_READ.defaultGrants).toEqual(['org_admin', 'beta_owner', 'beta_editor', 'beta_reader']);
    // `admin` was not mapped: the system role keeps the `*_any` grants.
    expect(mapped.SECRETS_READ_ANY.defaultGrants).toEqual(['admin']);
    for (const key of Object.keys(VAULT_PERMISSIONS) as Array<keyof typeof VAULT_PERMISSIONS>) {
      expect({ id: mapped[key].id, scope: mapped[key].scope }).toEqual({ id: VAULT_PERMISSIONS[key].id, scope: VAULT_PERMISSIONS[key].scope });
    }
  });

  it('grants nothing for a role mapped to an empty list', () => {
    expect(vaultPermissionDeclarations({ admin: [] }).MEDIA_DELETE_ANY.defaultGrants).toEqual([]);
  });
});

describe('the VAULT_HOST binding', () => {
  async function boot(bindings: VaultApiBindings) {
    const moduleRef = await Test.createTestingModule({ imports: [VaultApiModule.forRoot({ bindings })] })
      .overrideGuard(JwtAuthGuard)
      .useValue(allow)
      .overrideGuard(AiEnabledGuard)
      .useValue(allow)
      .compile();
    await moduleRef.init();
    return moduleRef;
  }

  it('puts the bound base URL into the notification payloads, and none without a binding', async () => {
    const run = {
      id: 'run-1', scope: 'user', trigger: 'manual', ownerId: 'user-1', startedAt: new Date('2030-01-01T00:00:00Z'),
    } as never;
    const outcome = { status: 'succeeded' as const, finishedAt: new Date('2030-01-01T00:01:00Z'), sizeBytes: 10, counts: null };

    const withHost = createFakeBindings();
    const bound = await boot({ ...withHost.bindings, host: { useValue: { appUrl: 'https://host.example.test' } } });
    expect(bound.get(VAULT_HOST, { strict: false })).toEqual({ appUrl: 'https://host.example.test' });
    await bound.get(BackupNotifier, { strict: false }).runSettled(run, outcome);
    expect(withHost.ports.notify.sent[0]!.data).toMatchObject({ appUrl: 'https://host.example.test' });
    expect(bound.get(CardExpiryScanHandler, { strict: false })).toBeInstanceOf(CardExpiryScanHandler);
    await bound.close();

    const without = createFakeBindings();
    const unbound = await boot(without.bindings);
    await unbound.get(BackupNotifier, { strict: false }).runSettled(run, outcome);
    expect(without.ports.notify.sent[0]!.data).not.toHaveProperty('appUrl');
    await unbound.close();
  });
});
