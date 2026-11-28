// =============================================================================
// The agent contract's shape snapshot and its change classifier (issue #196)
// =============================================================================
//
// `describeAgentContract` turns the public exports of `./agent` into plain data: for every Zod
// schema its field names, requiredness, nullability, enum values and nested shapes; for the
// permanent constants (`AGENT_SCOPES`, `AGENT_ERROR_CODES`, `AGENT_API_BASE_PATH`,
// `AGENT_CONTRACT_FEATURES`, `AGENT_IDENTITY_FIELDS`) their values. `diffAgentContract` compares
// two descriptions and classifies each difference by the stability promise
// (docs/agent-credential-api.md, "Stability"):
//
//   additive   a new optional request field, a new response field, a new enum value, a new scope,
//              error code or feature, a request field that became optional, a response field that
//              became required.
//   breaking   a removed or renamed field, schema or constant key; a changed constant value; a
//              request field that became required (or a new required request field); a response
//              field that became optional or nullable; a removed enum value; a changed type.
//
// `checkAgentContract` is the gate: a breaking difference passes only when the changelog has an
// entry for the new contract version marked `(breaking)` with `ACCEPT_BREAKING`, the major
// version grew, and the base path names that major (`/api/agent/v<major>`).
// =============================================================================

import type { ZodType } from 'zod';

/** Which way a schema travels; decides how requiredness changes are classified. */
export type SchemaRole = 'request' | 'response' | 'both';

export type Shape =
  | { type: 'object'; fields: Record<string, Field> }
  | { type: 'array'; element: Shape }
  | { type: 'enum'; values: string[] }
  | { type: 'union'; options: Shape[] }
  | { type: 'record'; value: Shape }
  | { type: 'primitive'; name: string };

export interface Field {
  required: boolean;
  nullable: boolean;
  shape: Shape;
}

export interface SchemaDescription {
  role: SchemaRole;
  required: boolean;
  nullable: boolean;
  shape: Shape;
}

export interface ContractDescription {
  version: string;
  schemas: Record<string, SchemaDescription>;
  constants: Record<string, Record<string, string> | string[] | string>;
}

export interface ContractChange {
  kind: 'additive' | 'breaking';
  path: string;
  what: string;
}

/** The constants the promise covers. */
export const PROMISED_CONSTANTS = [
  'AGENT_API_BASE_PATH',
  'AGENT_SCOPES',
  'AGENT_ERROR_CODES',
  'AGENT_CONTRACT_FEATURES',
  'AGENT_IDENTITY_FIELDS',
] as const;

/**
 * The role of every public schema of `./agent`. A new schema export must be added here (the
 * snapshot test fails until it is), which is the moment to decide which way it travels.
 */
export const SCHEMA_ROLES: Record<string, SchemaRole> = {
  // logins
  agentPurposeSchema: 'request',
  agentFillFieldSchema: 'request',
  agentOriginSchema: 'request',
  agentLookupQuerySchema: 'request',
  agentCredentialSummarySchema: 'response',
  agentLookupResponseSchema: 'response',
  agentFillRequestSchema: 'request',
  agentFillResponseSchema: 'response',
  agentTotpRequestSchema: 'request',
  agentTotpResponseSchema: 'response',
  agentGeneratePasswordSchema: 'request',
  agentCreateCredentialRequestSchema: 'request',
  agentCreateCredentialResponseSchema: 'response',
  agentRotatePasswordRequestSchema: 'request',
  agentRotatePasswordResponseSchema: 'response',
  agentWhoamiResponseSchema: 'response',
  agentContractInfoSchema: 'response',
  // cards and identity
  agentAmountSchema: 'request',
  agentCurrencySchema: 'request',
  agentCardFillFieldSchema: 'request',
  agentCardsLookupQuerySchema: 'request',
  agentCardGrantSummarySchema: 'response',
  agentCardSummarySchema: 'response',
  agentCardsLookupResponseSchema: 'response',
  agentCardFillRequestSchema: 'request',
  agentValueResponseSchema: 'response',
  agentCardGrantRequestCreateSchema: 'request',
  cardGrantRequestStatusSchema: 'response',
  agentCardGrantRequestResponseSchema: 'response',
  agentIdentityFieldSchema: 'request',
  agentIdentityLookupQuerySchema: 'request',
  agentIdentityFieldSummarySchema: 'response',
  agentIdentitySummarySchema: 'response',
  agentIdentityLookupResponseSchema: 'response',
  agentIdentityFillRequestSchema: 'request',
  // service keys (contract 1.4)
  agentServiceKeyParamsSchema: 'request',
  agentServiceKeyResponseSchema: 'response',
  // the owner's side and settings (read and written by the web app): both ways
  cardGrantPeriodLimitSchema: 'request',
  createCardGrantSchema: 'request',
  cardGrantStatusSchema: 'response',
  cardGrantSchema: 'response',
  cardGrantListResponseSchema: 'response',
  cardGrantRequestListQuerySchema: 'request',
  cardGrantRequestSchema: 'response',
  cardGrantRequestListResponseSchema: 'response',
  agentCardAccessSettingsSchema: 'both',
  agentBrokerSettingsSchema: 'both',
  agentIdentityAccessSettingsSchema: 'both',
  agentAccessSettingsSchema: 'both',
  agentActivityActionSchema: 'response',
  agentActivityCredentialKindSchema: 'response',
  agentActivityQuerySchema: 'request',
  agentActivityItemSchema: 'response',
  agentActivityResponseSchema: 'response',
};

interface Unwrapped {
  required: boolean;
  nullable: boolean;
  schema: ZodType;
}

type Def = { type: string; [key: string]: unknown };
const defOf = (schema: ZodType): Def => (schema as unknown as { _zod: { def: Def } })._zod.def;

/** Peels optional, default, nullable, readonly, catch and pipe (input side) wrappers. */
function unwrap(schema: ZodType): Unwrapped {
  let required = true;
  let nullable = false;
  let current = schema;
  for (let i = 0; i < 20; i += 1) {
    const def = defOf(current);
    if (def.type === 'optional' || def.type === 'default' || def.type === 'prefault') {
      required = false;
      current = def.innerType as ZodType;
    } else if (def.type === 'nullable') {
      nullable = true;
      current = def.innerType as ZodType;
    } else if (def.type === 'readonly' || def.type === 'catch' || def.type === 'nonoptional') {
      current = def.innerType as ZodType;
    } else if (def.type === 'pipe') {
      current = def.in as ZodType;
    } else {
      break;
    }
  }
  return { required, nullable, schema: current };
}

function describeShape(schema: ZodType): Shape {
  const def = defOf(schema);
  switch (def.type) {
    case 'object': {
      const fields: Record<string, Field> = {};
      for (const [name, child] of Object.entries(def.shape as Record<string, ZodType>)) {
        const u = unwrap(child);
        fields[name] = { required: u.required, nullable: u.nullable, shape: describeShape(u.schema) };
      }
      return { type: 'object', fields };
    }
    case 'array':
      return { type: 'array', element: describeShape(unwrap(def.element as ZodType).schema) };
    case 'enum':
      return { type: 'enum', values: Object.values(def.entries as Record<string, string | number>).map(String) };
    case 'literal':
      return { type: 'enum', values: (def.values as unknown[]).map((v) => String(v)) };
    case 'union':
      return { type: 'union', options: (def.options as ZodType[]).map((o) => describeShape(unwrap(o).schema)) };
    case 'record':
      return { type: 'record', value: describeShape(unwrap(def.valueType as ZodType).schema) };
    default:
      return { type: 'primitive', name: def.type };
  }
}

const isZod = (value: unknown): value is ZodType =>
  typeof value === 'object' && value !== null && '_zod' in value && typeof (value as { safeParse?: unknown }).safeParse === 'function';

/** The description of a module's exports (the real `./agent`, or a test's modified copy). */
export function describeAgentContract(exports: Record<string, unknown>): ContractDescription {
  const schemas: Record<string, SchemaDescription> = {};
  for (const [name, value] of Object.entries(exports).sort(([a], [b]) => a.localeCompare(b))) {
    if (!isZod(value)) continue;
    const u = unwrap(value);
    schemas[name] = { role: SCHEMA_ROLES[name] ?? 'both', required: u.required, nullable: u.nullable, shape: describeShape(u.schema) };
  }
  const constants: ContractDescription['constants'] = {};
  for (const name of PROMISED_CONSTANTS) {
    const value = exports[name];
    if (typeof value === 'string') constants[name] = value;
    else if (Array.isArray(value)) constants[name] = value.map(String);
    else if (value && typeof value === 'object') constants[name] = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)]));
  }
  return { version: String(exports.AGENT_CONTRACT_VERSION ?? ''), schemas, constants };
}

function requirednessChange(role: SchemaRole, path: string, was: boolean, now: boolean, out: ContractChange[]): void {
  if (was === now) return;
  const toRequired = !was && now;
  const breaking = role === 'both' || (role === 'request' ? toRequired : !toRequired);
  out.push({ kind: breaking ? 'breaking' : 'additive', path, what: toRequired ? 'became required' : 'became optional' });
}

function nullabilityChange(role: SchemaRole, path: string, was: boolean, now: boolean, out: ContractChange[]): void {
  if (was === now) return;
  const toNullable = !was && now;
  const breaking = role === 'both' || (role === 'request' ? !toNullable : toNullable);
  out.push({ kind: breaking ? 'breaking' : 'additive', path, what: toNullable ? 'became nullable' : 'is no longer nullable' });
}

function diffShape(role: SchemaRole, path: string, was: Shape, now: Shape, out: ContractChange[]): void {
  if (was.type !== now.type) {
    out.push({ kind: 'breaking', path, what: `type changed from ${was.type} to ${now.type}` });
    return;
  }
  switch (was.type) {
    case 'object': {
      const nowFields = (now as Extract<Shape, { type: 'object' }>).fields;
      for (const [name, field] of Object.entries(was.fields)) {
        const next = nowFields[name];
        const at = `${path}.${name}`;
        if (!next) {
          out.push({ kind: 'breaking', path: at, what: 'field removed or renamed' });
          continue;
        }
        requirednessChange(role, at, field.required, next.required, out);
        nullabilityChange(role, at, field.nullable, next.nullable, out);
        diffShape(role, at, field.shape, next.shape, out);
      }
      for (const [name, field] of Object.entries(nowFields)) {
        if (name in was.fields) continue;
        const breaking = role !== 'response' && field.required;
        out.push({ kind: breaking ? 'breaking' : 'additive', path: `${path}.${name}`, what: field.required ? 'new required field' : 'new optional field' });
      }
      return;
    }
    case 'array':
      diffShape(role, `${path}[]`, was.element, (now as Extract<Shape, { type: 'array' }>).element, out);
      return;
    case 'record':
      diffShape(role, `${path}{}`, was.value, (now as Extract<Shape, { type: 'record' }>).value, out);
      return;
    case 'enum': {
      const nowValues = (now as Extract<Shape, { type: 'enum' }>).values;
      for (const v of was.values) if (!nowValues.includes(v)) out.push({ kind: 'breaking', path, what: `enum value '${v}' removed` });
      for (const v of nowValues) if (!was.values.includes(v)) out.push({ kind: 'additive', path, what: `enum value '${v}' added` });
      return;
    }
    case 'union':
      if (JSON.stringify(was) !== JSON.stringify(now)) out.push({ kind: 'breaking', path, what: 'union options changed' });
      return;
    case 'primitive':
      if (was.name !== (now as Extract<Shape, { type: 'primitive' }>).name) {
        out.push({ kind: 'breaking', path, what: `type changed from ${was.name} to ${(now as { name: string }).name}` });
      }
      return;
  }
}

/** Every difference between two descriptions, classified. */
export function diffAgentContract(was: ContractDescription, now: ContractDescription): ContractChange[] {
  const out: ContractChange[] = [];
  for (const [name, schema] of Object.entries(was.schemas)) {
    const next = now.schemas[name];
    if (!next) {
      out.push({ kind: 'breaking', path: name, what: 'schema removed or renamed' });
      continue;
    }
    const role = schema.role === next.role ? schema.role : 'both';
    requirednessChange(role, name, schema.required, next.required, out);
    nullabilityChange(role, name, schema.nullable, next.nullable, out);
    diffShape(role, name, schema.shape, next.shape, out);
  }
  for (const name of Object.keys(now.schemas)) {
    if (!(name in was.schemas)) out.push({ kind: 'additive', path: name, what: 'new schema' });
  }
  for (const [name, value] of Object.entries(was.constants)) {
    const next = now.constants[name];
    if (next === undefined) {
      out.push({ kind: 'breaking', path: name, what: 'constant removed' });
    } else if (typeof value === 'string') {
      if (next !== value) out.push({ kind: 'breaking', path: name, what: `changed from '${value}' to '${String(next)}'` });
    } else if (Array.isArray(value)) {
      const list = Array.isArray(next) ? next : [];
      for (const v of value) if (!list.includes(v)) out.push({ kind: 'breaking', path: name, what: `'${v}' removed` });
      for (const v of list) if (!value.includes(v)) out.push({ kind: 'additive', path: name, what: `'${v}' added` });
    } else {
      const map = (typeof next === 'object' && !Array.isArray(next) ? next : {}) as Record<string, string>;
      for (const [key, v] of Object.entries(value)) {
        if (!(key in map)) out.push({ kind: 'breaking', path: `${name}.${key}`, what: `'${v}' removed or renamed` });
        else if (map[key] !== v) out.push({ kind: 'breaking', path: `${name}.${key}`, what: `value changed from '${v}' to '${map[key]}'` });
      }
      for (const [key, v] of Object.entries(map)) if (!(key in value)) out.push({ kind: 'additive', path: `${name}.${key}`, what: `'${v}' added` });
    }
  }
  for (const name of Object.keys(now.constants)) {
    if (!(name in was.constants)) out.push({ kind: 'additive', path: name, what: 'new constant' });
  }
  return out;
}

/** One entry of the "Changes" section. */
export interface ChangelogEntry {
  version: string;
  kind: string;
  acceptBreaking: boolean;
  body: string;
}

/**
 * The entries of the `## 8. Changes` section of the guide: `### <version> (additive|breaking)`
 * headings, newest first. A breaking entry must say `ACCEPT_BREAKING` to be accepted.
 */
export function parseChangelog(markdown: string): ChangelogEntry[] {
  const start = markdown.search(/^## \d+\. Changes\s*$/m);
  if (start < 0) return [];
  const rest = markdown.slice(start).split(/\n(?=## )/)[0]!;
  const entries: ChangelogEntry[] = [];
  const re = /^### (\S+) \(([a-z]+)\)(.*)$/gm;
  const heads = [...rest.matchAll(re)];
  heads.forEach((m, i) => {
    const end = i + 1 < heads.length ? heads[i + 1]!.index! : rest.length;
    const body = rest.slice(m.index! + m[0].length, end);
    entries.push({ version: m[1]!, kind: m[2]!, acceptBreaking: /ACCEPT_BREAKING/.test(m[3]! + body), body });
  });
  return entries;
}

export interface ContractCheck {
  changes: ContractChange[];
  breaking: ContractChange[];
  additive: ContractChange[];
  /** Why the gate fails; empty when it passes. */
  problems: string[];
}

const major = (version: string) => Number(version.split('.')[0]);

/**
 * The gate. `snapshot` is the committed description; `current` is the code's. Passes on additive
 * changes; fails on a breaking one unless it was accepted deliberately (see the file comment), and
 * fails when the versions and the changelog disagree.
 */
export function checkAgentContract(snapshot: ContractDescription, current: ContractDescription, changelog: string): ContractCheck {
  const changes = diffAgentContract(snapshot, current);
  const breaking = changes.filter((c) => c.kind === 'breaking');
  const additive = changes.filter((c) => c.kind === 'additive');
  const problems: string[] = [];
  const entries = parseChangelog(changelog);
  const entry = entries.find((e) => e.version === current.version);

  if (!/^\d+\.\d+$/.test(current.version)) problems.push(`AGENT_CONTRACT_VERSION '${current.version}' is not <major>.<minor>`);
  if (!entry) problems.push(`the changelog has no entry for contract ${current.version}`);
  if (!entries.some((e) => e.version === snapshot.version)) problems.push(`the changelog has no entry for the snapshot's contract ${snapshot.version}`);
  for (const e of entries) {
    if (e.kind !== 'additive' && e.kind !== 'breaking') problems.push(`changelog entry ${e.version} is marked '${e.kind}', expected additive or breaking`);
    if (e.kind === 'breaking' && !e.acceptBreaking) problems.push(`changelog entry ${e.version} is breaking but does not say ACCEPT_BREAKING`);
  }

  if (breaking.length > 0) {
    const basePath = String(current.constants.AGENT_API_BASE_PATH ?? '');
    const accepted =
      entry?.kind === 'breaking' &&
      entry.acceptBreaking &&
      major(current.version) > major(snapshot.version) &&
      basePath.endsWith(`/v${major(current.version)}`);
    if (!accepted) {
      problems.push(
        `${breaking.length} breaking change(s) to the agent contract: ${breaking
          .map((c) => `${c.path} (${c.what})`)
          .join('; ')}. A breaking change needs /api/agent/v${major(snapshot.version) + 1}, a new major AGENT_CONTRACT_VERSION, ` +
          'a "(breaking)" changelog entry that says ACCEPT_BREAKING, and a refreshed snapshot.',
      );
    }
  }
  return { changes, breaking, additive, problems };
}
