import { composedSchemaDatamodel } from '@marinoscar/platform-api/user-data';

// =============================================================================
// PLATFORM-ADOPTION-SHIM(E9.3): `{ field: { not: null } }` on a required column
// =============================================================================
//
// The factory reset's summary counts what a reset would delete per category with
// `delegate.count({ where: { [ownerField]: { not: null } } })` (`user-data.service.ts`,
// `summary`). For an owner column that is REQUIRED (`media_folders.user_id`, a personal
// access token's `user_id`, ...) Prisma 7 refuses the filter ("Argument `not` must not be
// null"), so `GET /api/admin/factory-reset/summary` answers 500 and the factory reset page
// cannot load. The filter is vacuous there (a required column is never null), so dropping
// it counts exactly what the platform meant to count.
//
// This wraps the bypass client the user-data slice receives (`USER_DATA_DB.system`) so a
// `count` with such a filter on a REQUIRED scalar of the model has that key removed. Nothing
// else is touched: every other method and every filter on an optional column pass through.
// A seam request on EnterpriseAppBase asks the platform to do this itself; this file is
// deleted with it (listed in docs/platform-adoption/local-exceptions.md).
// =============================================================================

type Where = Record<string, unknown>;

/**
 * Delegate name -> its required scalar field names, read once from the composed schema folder. The
 * generated client's runtime datamodel does not say whether a field is required (Prisma 7), the schema does.
 */
let requiredScalars: ReadonlyMap<string, ReadonlySet<string>> | undefined;

function requiredScalarsOf(delegate: string): ReadonlySet<string> | undefined {
  if (!requiredScalars) {
    const models = composedSchemaDatamodel(__dirname)();
    const modelNames = new Set(models.map((model) => model.name));
    requiredScalars = new Map(
      models.map((model) => [
        model.name.charAt(0).toLowerCase() + model.name.slice(1),
        new Set(
          model.fields
            .filter((field) => !field.isOptional && !field.isList && !field.relation && !modelNames.has(field.type))
            .map((field) => field.name),
        ),
      ]),
    );
  }
  return requiredScalars.get(delegate);
}

const isNotNull = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && Object.keys(value).length === 1 && 'not' in value && (value as { not: unknown }).not === null;

/**
 * `where` without the `{ not: null }` conditions on `required` columns.
 *
 * @param where - a Prisma `where` (anything else is returned as it is).
 * @param required - the model's required scalar fields.
 * @returns the same object when nothing was dropped.
 */
export function dropRequiredNotNull(where: unknown, required: ReadonlySet<string>): unknown {
  if (typeof where !== 'object' || where === null || Array.isArray(where)) return where;
  const entries = Object.entries(where as Where);
  if (!entries.some(([key, value]) => required.has(key) && isNotNull(value))) return where;
  return Object.fromEntries(entries.filter(([key, value]) => !(required.has(key) && isNotNull(value))));
}

/**
 * The client with {@link dropRequiredNotNull} applied to every `count`.
 *
 * @param client - the bypass client (`forSystem(reason)`).
 */
export function withRequiredFieldFilters<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, property) {
      // The target is the receiver: a Prisma client keeps its state behind its own proxy.
      const value = Reflect.get(target, property);
      const required = typeof property === 'string' ? requiredScalarsOf(property) : undefined;
      if (!required || (typeof value !== 'object' && typeof value !== 'function') || value === null) {
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      }
      return new Proxy(value as object, {
        get(delegate, method) {
          const original = Reflect.get(delegate, method);
          if (method !== 'count' || typeof original !== 'function') return typeof original === 'function' ? original.bind(delegate) : original;
          return (args?: { where?: unknown }) =>
            (original as (a?: unknown) => unknown).call(
              delegate,
              args && 'where' in args ? { ...args, where: dropRequiredNotNull(args.where, required) } : args,
            );
        },
      });
    },
  });
}
