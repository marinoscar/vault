// =============================================================================
// Every broker route is accounted for (issue #246, ADR-0006 Enforcement)
// =============================================================================
//
// The RBAC matrix (`test/rbac/vault-rbac-matrix.integration.spec.ts`) fails when a route of the
// listed controllers is missing from its table. The forwarding controller is `@Public()` with its own
// guard, so it is not a row there; this suite pins the whole broker surface so a new route cannot be
// added without a decision:
//
//   - the only routes of `BrokerController` are the two forwarding shapes, each behind `BrokerAuthGuard`;
//   - the only routes of `BrokerTokensController` are the four management routes, each of which the
//     RBAC matrix lists;
//   - the opt-in route is `secrets:write` and is in the matrix;
//   - nothing else in the application mentions the broker path.
// =============================================================================

import '../../src/app-registrations/registrations';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS_KEY } from '@marinoscar/platform-api/identity';
import { discoverControllers } from '@marinoscar/platform-api/identity/testing';
import { BrokerAuthGuard, BrokerController, BrokerTokensController } from '@marinoscar/vault-api/broker';

import { AppModule } from '../../src/app.module';

type Ctor = { prototype: Record<string, unknown>; name: string };

function routesOf(controller: Ctor): Array<{ route: string; handler: Function }> {
  const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
  const out: Array<{ route: string; handler: Function }> = [];
  for (const name of Object.getOwnPropertyNames(controller.prototype)) {
    const handler = controller.prototype[name];
    if (typeof handler !== 'function' || name === 'constructor') continue;
    const verb = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
    if (verb === undefined) continue;
    const sub = (Reflect.getMetadata(PATH_METADATA, handler) as string).replace(/^\/+|\/+$/g, '');
    out.push({ route: `${RequestMethod[verb]} /api/${[base, sub].filter(Boolean).join('/')}`, handler });
  }
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

describe('broker routes are all accounted for', () => {
  const controllers = discoverControllers(AppModule) as Ctor[];
  const matrix = readFileSync(join(__dirname, '..', 'rbac', 'vault-rbac-matrix.integration.spec.ts'), 'utf8');

  it('the forwarding controller has exactly the two forwarding routes, both behind BrokerAuthGuard', () => {
    const controller = controllers.find((c) => c.name === 'BrokerController')!;
    expect(controller as unknown).toBe(BrokerController);
    const routes = routesOf(controller);
    expect(routes.map((r) => r.route)).toEqual(['ALL /api/broker/v1/:secretId/:upstreamHost', 'ALL /api/broker/v1/:secretId/:upstreamHost/*']);
    const guards = (Reflect.getMetadata(GUARDS_METADATA, controller) ?? []) as unknown[];
    expect(guards).toContain(BrokerAuthGuard);
    for (const { handler } of routes) expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toBeUndefined();
  });

  it('the token controller has exactly the four management routes and the RBAC matrix lists each', () => {
    const controller = controllers.find((c) => c.name === 'BrokerTokensController')!;
    expect(controller as unknown).toBe(BrokerTokensController);
    const routes = routesOf(controller).map((r) => r.route);
    expect(routes).toEqual(['DELETE /api/broker/tokens/:id', 'GET /api/broker/tokens', 'POST /api/broker/tokens', 'POST /api/broker/tokens/:id/revoke']);
    for (const route of routes) {
      const [method, path] = route.split(' ');
      const asRow = path!.replace(':id', '${ID}');
      expect(matrix).toContain(`['${method}', ${asRow.includes('${') ? '`' : "'"}${asRow}${asRow.includes('${') ? '`' : "'"}, null]`);
    }
  });

  it('the opt-in route requires secrets:write and the RBAC matrix lists it', () => {
    const secrets = controllers.find((c) => c.name === 'SecretsController')!;
    const optIn = routesOf(secrets).find((r) => r.route === 'PATCH /api/secrets/:id/broker-access');
    expect(optIn).toBeDefined();
    expect(Reflect.getMetadata(PERMISSIONS_KEY, optIn!.handler)).toEqual(['secrets:write']);
    expect(matrix).toContain("['PATCH', `/api/secrets/${ID}/broker-access`, 'secrets:write']");
  });

  it('no other controller declares a broker route', () => {
    const others = controllers
      .filter((c) => c.name !== 'BrokerController' && c.name !== 'BrokerTokensController')
      .flatMap((c) => routesOf(c).map((r) => r.route))
      .filter((route) => /\/broker\b/.test(route) && !route.endsWith('/broker-access'));
    expect(others).toEqual([]);
  });
});
