import 'reflect-metadata';

import { ExecutionContext, RequestMethod } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AiEnabledGuard } from '@marinoscar/platform-api/ai';
import { JwtAuthGuard } from '@marinoscar/platform-api/identity';

import {
  BackupRunHandler,
  BackupsController,
  MyBackupsController,
  UserBackupRunHandler,
  BACKUP_RUN_JOB_TYPE,
  USER_BACKUP_RUN_JOB_TYPE,
} from '../src/backups';
import { CardExpiryScanHandler, CARD_EXPIRY_SCAN_JOB_TYPE } from '../src/card-expiry';
import { AiStatusController, CardExtractController } from '../src/ai';
import { MediaController } from '../src/media';
import { SecretsController } from '../src/secrets';
import { SecretTypesController } from '../src/secret-types';
import {
  VAULT_AI,
  VAULT_AI_CONFIG,
  VAULT_AI_KEY_PRESENCE,
  VAULT_AUDIT,
  VAULT_CRYPTO,
  VAULT_JOBS,
  VAULT_METRICS,
  VAULT_NOTIFY,
  VAULT_OBJECT_STORE,
  VAULT_OBJECTS,
  VAULT_PRISMA,
  VAULT_SETTINGS,
} from '../src/ports';
import { createFakeBindings, type FakeVaultPorts } from '../src/testing';
import { VaultApiModule, type VaultApiBindings } from '../src/vault-api.module';

// =============================================================================
// Conformance of @marinoscar/vault-api over FAKE ports (issue #103, E12.2)
// =============================================================================
//
// The package must boot, register its job handlers and expose its routes with nothing but the
// twelve ports bound to in-memory fakes: no database, no queue, no object store, no platform
// service. A slice that reaches around a port (an import of a platform service, a read of the
// environment) fails to resolve here. The host's own proof is the integration, RBAC and
// real-database tiers of apps/api, which run this same code over the real bindings.
// =============================================================================

const allowEverything = { canActivate: (_ctx: ExecutionContext) => true };

async function boot(bindings: VaultApiBindings): Promise<TestingModule> {
  const moduleRef = await Test.createTestingModule({ imports: [VaultApiModule.forRoot({ bindings })] })
    // Authentication is the platform's; RolesGuard and PermissionsGuard stay real.
    .overrideGuard(JwtAuthGuard)
    .useValue(allowEverything)
    .overrideGuard(AiEnabledGuard)
    .useValue(allowEverything)
    .compile();
  await moduleRef.init();
  return moduleRef;
}

const CONTROLLERS = [
  SecretTypesController,
  SecretsController,
  MediaController,
  AiStatusController,
  CardExtractController,
  BackupsController,
  MyBackupsController,
];

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

describe('vault-api conformance (fake ports)', () => {
  let moduleRef: TestingModule;
  let ports: FakeVaultPorts;

  beforeAll(async () => {
    const fake = createFakeBindings();
    ports = fake.ports;
    moduleRef = await boot(fake.bindings);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('exports every port token under its permanent description', () => {
    const tokens = [
      [VAULT_PRISMA, 'VAULT_PRISMA'],
      [VAULT_CRYPTO, 'VAULT_CRYPTO'],
      [VAULT_OBJECT_STORE, 'VAULT_OBJECT_STORE'],
      [VAULT_OBJECTS, 'VAULT_OBJECTS'],
      [VAULT_JOBS, 'VAULT_JOBS'],
      [VAULT_NOTIFY, 'VAULT_NOTIFY'],
      [VAULT_AI, 'VAULT_AI'],
      [VAULT_AI_CONFIG, 'VAULT_AI_CONFIG'],
      [VAULT_AI_KEY_PRESENCE, 'VAULT_AI_KEY_PRESENCE'],
      [VAULT_AUDIT, 'VAULT_AUDIT'],
      [VAULT_SETTINGS, 'VAULT_SETTINGS'],
      [VAULT_METRICS, 'VAULT_METRICS'],
    ] as const;
    for (const [token, name] of tokens) {
      expect(token).toBe(Symbol.for(`@marinoscar/vault/${name}`));
      expect(moduleRef.get(token, { strict: false })).toBeDefined();
    }
  });

  it('resolves every controller with the fakes alone', () => {
    for (const controller of CONTROLLERS) {
      expect(moduleRef.get(controller, { strict: false })).toBeInstanceOf(controller);
    }
  });

  it('registers the three job handlers through the jobs port, under their permanent types', () => {
    expect([...ports.jobs.handlers.keys()].sort()).toEqual(
      ['vault.backup.run', 'vault.cards.expiry_scan', 'vault.user_backup.run'],
    );
    expect(BACKUP_RUN_JOB_TYPE).toBe('vault.backup.run');
    expect(USER_BACKUP_RUN_JOB_TYPE).toBe('vault.user_backup.run');
    expect(CARD_EXPIRY_SCAN_JOB_TYPE).toBe('vault.cards.expiry_scan');
  });

  it('keeps every job server-only: no nodeResultSchema, no persistNodeResult', () => {
    for (const handler of [BackupRunHandler, UserBackupRunHandler, CardExpiryScanHandler]) {
      const instance = moduleRef.get(handler, { strict: false }) as unknown as Record<string, unknown>;
      expect(instance.nodeResultSchema).toBeUndefined();
      expect(instance.persistNodeResult).toBeUndefined();
      expect(instance.nodeSecretBroker).toBeUndefined();
    }
  });

  it('exposes exactly the routes the API always had', () => {
    expect(CONTROLLERS.flatMap(routesOf).sort()).toMatchSnapshot();
  });

  it('puts the JWT guard on every controller (security by default: no public domain route)', () => {
    for (const controller of CONTROLLERS) {
      const classGuards: unknown[] = Reflect.getMetadata('__guards__', controller) ?? [];
      const proto = controller.prototype as unknown as Record<string, unknown>;
      const routes = Object.getOwnPropertyNames(proto).filter(
        (name) => name !== 'constructor' && Reflect.getMetadata('method', proto[name] as object) !== undefined,
      );
      for (const name of routes) {
        const guards: unknown[] = [...classGuards, ...(Reflect.getMetadata('__guards__', proto[name] as object) ?? [])];
        expect({ route: `${controller.name}.${name}`, jwt: guards.includes(JwtAuthGuard) }).toEqual({
          route: `${controller.name}.${name}`,
          jwt: true,
        });
      }
    }
  });

  it('refuses to boot when a required port is not bound, naming the token', async () => {
    const { bindings } = createFakeBindings();
    const { crypto: _omitted, ...rest } = bindings;
    await expect(boot(rest as unknown as VaultApiBindings)).rejects.toThrow(/VAULT_CRYPTO/);
  });

  it('boots without the optional metrics port, and emits nothing', async () => {
    const { bindings } = createFakeBindings();
    const { metrics: _metrics, ...rest } = bindings;
    const app = await boot(rest);
    expect(app.get(SecretsController, { strict: false })).toBeInstanceOf(SecretsController);
    await app.close();
  });
});

describe('the cipher port', () => {
  it('round-trips and never returns the plaintext in the ciphertext', () => {
    const { ports } = createFakeBindings();
    const encrypted = ports.crypto.encrypt('card-number-0000');
    expect(encrypted.ciphertext).not.toContain('card-number');
    expect(ports.crypto.decrypt(encrypted.ciphertext, encrypted.iv, encrypted.authTag)).toBe('card-number-0000');
  });
});
