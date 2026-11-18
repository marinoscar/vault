// =============================================================================
// What the MCP tools may see and do to secrets (issue #180, E14.8, epic #172)
// =============================================================================
//
// The one place the MCP surface touches secret data, and the place the "never a plaintext value"
// rule is built in, twice:
//
//   1. RESULTS ARE BUILT FROM AN ALLOW-LIST. A view carries the id, name, type, origins, agent access,
//      timestamps and the values of fields the type marks NOT sensitive (and a name deny-list on top:
//      `password`, `totp`, `key`, `number`, `cvv`, ... are sensitive whatever a custom type says).
//      A sensitive field is the string "[hidden]" or absent. Attachments and card types never appear.
//   2. EVERY SENSITIVE VALUE SEEN IS REPORTED (`sensitive`), and the dispatcher withholds a result in
//      which one appears (fail closed).
//
// VISIBILITY: MCP sees only the caller's own Credentials opened to agents (`agentAccess = 'fill'`,
// E14.3). A secret created through MCP with `allowAgents: true` is opened to agents at creation, so it
// is visible; with `allowAgents: false` it is created closed and stays invisible to MCP (search, get
// and update answer "not found") until the user opens it in Vault. There is no marker for "created by
// MCP": visibility is the one agent-access switch the user already controls.
//
// URLs are not updatable here: pointing a login the user opened to agents at another website would
// let a model redirect a later fill request (`url` and `additional_urls` are refused in update_secret).
// =============================================================================

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { normalizeOrigin } from '@marinoscar/vault-contract/secrets';

import { generatePassword, type GeneratePasswordOptions } from '../agent/password-generator';
import { VAULT_PRISMA, type VaultPrismaClient } from '../ports';
import { SecretsService } from '../secrets/secrets.service';
import { McpToolError } from './protocol/mcp-tool';

/** What a hidden field reads as. */
export const HIDDEN = '[hidden]';

/** The most results one search returns. */
export const MCP_SEARCH_MAX_LIMIT = 50;

/** Fields that are sensitive whatever the type's definition says (a custom type may forget the flag). */
const SENSITIVE_NAME = /^(password|passcode|pin|totp|totp_secret|otp|otp_seed|seed|key|api_key|private_key|secret|token|number|card_number|cvv|cvc|security_code(_\d+)?)$/i;

/** Fields of a type as stored. */
interface TypeField {
  name: string;
  label?: string;
  type: string;
  required?: boolean;
  sensitive?: boolean;
  options?: string[];
}

interface TypeRow {
  id: string;
  name: string;
  isSystem?: boolean;
  description?: string | null;
  fields: unknown;
}

/** Fields the MCP update refuses (see the header). */
const NOT_UPDATABLE = new Set(['url', 'additional_urls']);

function fieldsOf(type: { fields: unknown }): TypeField[] {
  return Array.isArray(type.fields) ? (type.fields as TypeField[]) : [];
}

function isSensitive(field: TypeField): boolean {
  return field.sensitive === true || SENSITIVE_NAME.test(field.name);
}

/** Card types are never handled through MCP: no creation, no listing. */
export function isCardLikeType(type: { name: string; isSystem?: boolean; fields: unknown }): boolean {
  if (type.isSystem && type.name.toLowerCase() === 'card') return true;
  return fieldsOf(type).some((f) => /^(cvv|cvc|security_code(_\d+)?)$/i.test(f.name));
}

const asText = (v: unknown): string => (typeof v === 'string' ? v : String(v));
const present = (v: unknown): boolean => v !== undefined && v !== null && v !== '';

/** One secret as the model sees it. */
export interface McpSecretView {
  id: string;
  name: string;
  type: string;
  origins: string[];
  agentAccess: string;
  version?: number | null;
  updatedAt: string;
  /** Non-sensitive field values (and, for `get_secret`, `"[hidden]"` for the sensitive fields that are set). */
  fields: Record<string, string>;
}

/** A view plus every sensitive value the build decrypted. */
interface ViewResult {
  view: McpSecretView;
  sensitive: string[];
}

/** Who is acting. */
export interface McpActor {
  userId: string;
  permissions: readonly string[];
}

/**
 * The secret operations behind the five tools. Never returns a decrypted sensitive value.
 *
 * @stability experimental
 */
@Injectable()
export class McpSecretsService {
  constructor(
    @Inject(VAULT_PRISMA) private readonly prisma: VaultPrismaClient,
    private readonly secrets: SecretsService,
  ) {}

  /** Builds the allow-listed view of one secret from its decrypted values. */
  private buildView(
    row: { id: string; name: string; origins?: string[] | null; agentAccess?: string | null; updatedAt: Date | string; type: TypeRow; versions?: Array<{ version: number }> },
    values: Record<string, unknown>,
    mode: 'search' | 'detail',
  ): ViewResult {
    const fields: Record<string, string> = {};
    const sensitive: string[] = [];
    for (const def of fieldsOf(row.type)) {
      const value = values[def.name];
      if (!present(value)) continue;
      if (isSensitive(def)) {
        sensitive.push(asText(value));
        if (mode === 'detail') fields[def.name] = HIDDEN;
      } else {
        fields[def.name] = asText(value);
      }
    }
    return {
      view: {
        id: row.id,
        name: row.name,
        type: row.type.name,
        origins: row.origins ?? [],
        agentAccess: row.agentAccess ?? 'none',
        ...(row.versions ? { version: row.versions[0]?.version ?? null } : {}),
        updatedAt: new Date(row.updatedAt).toISOString(),
        fields,
      },
      sensitive,
    };
  }

  /** The caller's Credentials opened to agents, filtered. */
  async search(
    actor: McpActor,
    input: { query?: string; type?: string; origin?: string; limit?: number },
  ): Promise<{ items: McpSecretView[]; sensitive: string[] }> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), MCP_SEARCH_MAX_LIMIT);
    // Only Credentials can be opened to agents.
    if (input.type && input.type.trim().toLowerCase() !== 'credential') return { items: [], sensitive: [] };

    let ids: string[] | undefined;
    if (input.origin) {
      const origin = normalizeOrigin(input.origin);
      if (!origin) throw new McpToolError('origin must be a valid https origin such as https://app.example.test', 'INVALID_ARGUMENTS');
      ids = (await this.secrets.findCredentialsByOrigin(actor.userId, origin)).map((m) => m.id);
      if (ids.length === 0) return { items: [], sensitive: [] };
    }

    const rows = await this.prisma.secret.findMany({
      where: {
        createdById: actor.userId,
        agentAccess: 'fill',
        type: { name: 'Credential', isSystem: true },
        ...(ids ? { id: { in: ids } } : {}),
        ...(input.query ? { name: { contains: input.query, mode: 'insensitive' as const } } : {}),
      },
      include: { type: true, versions: { where: { isCurrent: true }, select: { version: true } } },
      orderBy: { name: 'asc' },
      take: limit,
    });

    const items: McpSecretView[] = [];
    const sensitive: string[] = [];
    for (const row of rows) {
      if (isCardLikeType(row.type)) continue;
      const values = await this.secrets.readCurrentValues(row.id);
      const built = this.buildView(row, values, 'search');
      items.push(built.view);
      sensitive.push(...built.sensitive);
    }
    return { items, sensitive };
  }

  /** One visible secret, sensitive fields as `[hidden]`. 404 (NotFoundException) when not visible. */
  async get(actor: McpActor, id: string): Promise<{ item: McpSecretView; sensitive: string[] }> {
    const row = await this.visible(actor.userId, id);
    const values = await this.secrets.readCurrentValues(id);
    const built = this.buildView(row, values, 'detail');
    return { item: built.view, sensitive: built.sensitive };
  }

  /** The caller's secret `id` when it is open to agents; the same 404 as a missing one otherwise. */
  private async visible(userId: string, id: string) {
    const row = await this.prisma.secret.findFirst({
      where: { id, createdById: userId, agentAccess: 'fill', type: { name: 'Credential', isSystem: true } },
      include: { type: true, versions: { where: { isCurrent: true }, select: { version: true } } },
    });
    if (!row || isCardLikeType(row.type)) throw new NotFoundException('Secret not found');
    return row;
  }

  /** The types a model may use: names and field definitions. Card types are not listed. */
  async listTypes(): Promise<Array<Record<string, unknown>>> {
    const types: TypeRow[] = await this.prisma.secretType.findMany({ orderBy: { name: 'asc' } });
    return types
      .filter((t) => !isCardLikeType(t))
      .map((t) => ({
        name: t.name,
        description: t.description ?? null,
        // Only a Credential can be opened to agents, so only its secrets show up in search_secrets and get_secret.
        canOpenToAgents: t.isSystem === true && t.name === 'Credential',
        fields: fieldsOf(t).map((f) => ({
          name: f.name,
          label: f.label ?? f.name,
          type: f.type,
          required: f.required === true,
          sensitive: isSensitive(f),
          ...(f.options && f.options.length > 0 ? { options: f.options } : {}),
        })),
      }));
  }

  /** Creates a secret. A generated password is stored and never returned. */
  async create(
    actor: McpActor,
    input: {
      type: string;
      name: string;
      fields: Record<string, string | number>;
      generatePassword?: GeneratePasswordOptions;
      allowAgents?: boolean;
    },
  ): Promise<{ result: Record<string, unknown>; secretId: string; sensitive: string[] }> {
    const type: TypeRow | null = await this.prisma.secretType.findFirst({
      where: { name: { equals: input.type.trim(), mode: 'insensitive' } },
    });
    if (!type) throw new McpToolError(`There is no secret type "${input.type}". Use list_secret_types to see the names.`, 'TYPE_NOT_FOUND');
    if (isCardLikeType(type)) {
      throw new McpToolError('Card data is never handled through this connection. The user adds cards in Vault.', 'TYPE_NOT_SUPPORTED');
    }
    const isCredential = type.isSystem === true && type.name === 'Credential';
    if (input.allowAgents && !isCredential) {
      throw new McpToolError('allowAgents applies to Credential secrets only: only a Credential can be opened to agents.', 'INVALID_ARGUMENTS');
    }

    const data: Record<string, unknown> = { ...input.fields };
    let generated: string | undefined;
    if (input.generatePassword) {
      const passwordField = fieldsOf(type).find((f) => f.name === 'password');
      if (!passwordField) {
        throw new McpToolError(`The type ${type.name} has no "password" field to generate into.`, 'INVALID_ARGUMENTS');
      }
      if (present(data.password)) {
        throw new McpToolError('Send either fields.password or generatePassword, not both.', 'INVALID_ARGUMENTS');
      }
      try {
        generated = generatePassword(input.generatePassword);
      } catch (error) {
        throw new McpToolError((error as Error).message, 'INVALID_ARGUMENTS');
      }
      data.password = generated;
    }

    // Every sensitive value this call handles: the ones the model sent and the one Vault generated.
    const sensitive: string[] = [];
    for (const def of fieldsOf(type)) if (isSensitive(def) && present(data[def.name])) sensitive.push(asText(data[def.name]));

    let created: { id: string; name: string; origins?: string[] };
    if (isCredential && input.allowAgents) {
      created = await this.secrets.createAgentCredential(actor.userId, { name: input.name, values: data });
    } else {
      const made = await this.secrets.create({ typeId: type.id, name: input.name, data } as never, actor.userId, [...actor.permissions]);
      created = { id: made.id, name: made.name, origins: (made as { origins?: string[] }).origins ?? [] };
    }

    const open = isCredential && input.allowAgents === true;
    return {
      secretId: created.id,
      sensitive,
      result: {
        id: created.id,
        name: created.name,
        type: type.name,
        origins: created.origins ?? [],
        agentAccess: open ? 'fill' : 'none',
        version: 1,
        ...(generated !== undefined ? { passwordGenerated: true, passwordReturned: false } : {}),
        note: open
          ? 'Opened to agents: it appears in search_secrets. The user can read any hidden value in Vault.'
          : 'Not opened to agents, so it will not appear in search_secrets or get_secret. The user can open it to agents in Vault.',
      },
    };
  }

  /** Changes the given fields of a visible secret; everything else keeps its value. */
  async update(
    actor: McpActor,
    input: { id: string; fields: Record<string, string | number> },
  ): Promise<{ result: Record<string, unknown>; secretId: string; sensitive: string[] }> {
    const names = Object.keys(input.fields);
    if (names.length === 0) throw new McpToolError('fields is empty: name at least one field to change.', 'INVALID_ARGUMENTS', input.id);
    const blocked = names.filter((n) => NOT_UPDATABLE.has(n));
    if (blocked.length > 0) {
      throw new McpToolError(
        `${blocked.join(', ')} cannot be changed through this connection: a login's website decides where Vault would fill it. The user changes it in Vault.`,
        'FIELD_NOT_UPDATABLE',
        input.id,
      );
    }

    const row = await this.visible(actor.userId, input.id);
    const current = await this.secrets.readCurrentValues(input.id);
    const merged: Record<string, unknown> = { ...current };
    for (const [name, value] of Object.entries(input.fields)) {
      if (value === '') delete merged[name];
      else merged[name] = value;
    }

    const sensitive: string[] = [];
    for (const def of fieldsOf(row.type)) {
      if (!isSensitive(def)) continue;
      if (present(current[def.name])) sensitive.push(asText(current[def.name]));
      if (present(merged[def.name])) sensitive.push(asText(merged[def.name]));
    }

    const same = Object.keys(merged).length === Object.keys(current).length && Object.keys(merged).every((k) => merged[k] === current[k]);
    if (same) {
      return {
        secretId: input.id,
        sensitive,
        result: { id: input.id, version: row.versions?.[0]?.version ?? null, changed: false, updatedFields: [] },
      };
    }

    const updated = await this.secrets.update(input.id, { data: merged } as never, actor.userId, [...actor.permissions]);
    return {
      secretId: input.id,
      sensitive,
      result: { id: input.id, version: updated.currentVersion, changed: true, updatedFields: names },
    };
  }
}
