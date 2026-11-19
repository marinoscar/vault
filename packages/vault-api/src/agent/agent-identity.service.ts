import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AGENT_AUDIT_ACTIONS,
  AGENT_ERROR_CODES,
  AGENT_IDENTITY_FIELDS,
  type AgentIdentityField,
  type AgentIdentityFillRequest,
  type AgentIdentitySummary,
} from '@marinoscar/vault-contract/agent';
import { normalizeOrigin } from '@marinoscar/vault-contract/secrets';
import { SYSTEM_SECRET_TYPES } from '@marinoscar/vault-contract/secret-types';

import { SecretsService } from '../secrets/secrets.service';
import { AgentCallPipeline, agentForbidden, type AgentAuditContext, type AgentCaller } from './agent-pipeline';

interface FieldDef {
  name: string;
  label: string;
  sensitive: boolean;
}

/** The Identity type's field definitions as seeded: the fallback when a stored type row is malformed. */
const SEEDED_IDENTITY_FIELDS: readonly FieldDef[] =
  SYSTEM_SECRET_TYPES.find((type) => type.name === 'Identity')?.fields.map((f) => ({ name: f.name, label: f.label, sensitive: f.sensitive })) ?? [];

/**
 * The releasable fields of an Identity item, from its stored type (labels and the `sensitive` flag
 * as the deployment has them), limited to {@link AGENT_IDENTITY_FIELDS}. A field the stored type
 * does not mark is treated as sensitive when the seeded definition says so: the stricter of the two.
 */
function identityFields(type: { fields?: unknown } | null | undefined): FieldDef[] {
  const stored = Array.isArray(type?.fields) ? (type!.fields as Array<Record<string, unknown>>) : [];
  const allowed = new Set<string>(AGENT_IDENTITY_FIELDS);
  const out: FieldDef[] = [];
  for (const name of AGENT_IDENTITY_FIELDS) {
    const row = stored.find((f) => f?.name === name);
    const seeded = SEEDED_IDENTITY_FIELDS.find((f) => f.name === name);
    if (!row && !seeded) continue;
    if (!allowed.has(name)) continue;
    out.push({
      name,
      label: typeof row?.label === 'string' ? row.label : (seeded?.label ?? name),
      sensitive: row?.sensitive === true || seeded?.sensitive === true,
    });
  }
  return out;
}

/**
 * The identity half of the agent rules (ADR-0003): list the opened Identity items with the labels
 * of their fields, and release ONE field. A sensitive field (`date_of_birth`, `id_number`) is
 * released only to an origin exactly on the item's allowed origins (`secrets.agent_origins`, set by
 * the owner). Behind both kill switches (`agentAccess.enabled`, `agentAccess.identity.enabled`).
 *
 * @stability experimental
 */
@Injectable()
export class AgentIdentityService {
  constructor(
    private readonly secrets: SecretsService,
    private readonly pipeline: AgentCallPipeline,
  ) {}

  private requireOrigin(input: string): string {
    const origin = normalizeOrigin(input);
    if (!origin) throw new BadRequestException('origin is not a valid https origin');
    return origin;
  }

  /** `GET /identity?origin=`: opened items, their field labels and what is fillable here. Never a value. */
  async identityLookup(caller: AgentCaller, rawOrigin: string): Promise<AgentIdentitySummary[]> {
    const ctx: AgentAuditContext = {};
    return this.pipeline.run(
      caller,
      { action: AGENT_AUDIT_ACTIONS.IDENTITY_LOOKUP, bucket: 'lookup', gate: 'identity' },
      ctx,
      async () => {
        const origin = this.requireOrigin(rawOrigin);
        ctx.origin = origin;
        const items = await this.secrets.listAgentOpenedSecrets(caller.userId, 'Identity');
        ctx.extra = { matches: items.length };
        return items.map((item) => {
          const allowed = ((item as { agentOrigins?: string[] }).agentOrigins ?? []).includes(origin);
          return {
            id: item.id,
            name: item.name,
            originAllowed: allowed,
            fields: identityFields(item.type).map((f) => ({
              field: f.name as AgentIdentityField,
              label: f.label,
              sensitive: f.sensitive,
              fillable: !f.sensitive || allowed,
            })),
          };
        });
      },
    );
  }

  /** `POST /identity/:id/fill`: ONE field; a sensitive one only on an allowed origin. */
  async identityFill(caller: AgentCaller, id: string, body: AgentIdentityFillRequest): Promise<{ value: string }> {
    const ctx: AgentAuditContext = { field: body.field, purpose: body.purpose };
    return this.pipeline.run(
      caller,
      { action: AGENT_AUDIT_ACTIONS.IDENTITY_FILL, bucket: 'identity_fill', gate: 'identity' },
      ctx,
      async () => {
        ctx.secretId = id;
        const item = await this.secrets.findAgentOpenedSecret(caller.userId, id, 'Identity');
        if (!item) throw new NotFoundException('Identity not found');
        ctx.secretName = item.name;
        const origin = this.requireOrigin(body.origin);
        ctx.origin = origin;
        const field = identityFields(item.type).find((f) => f.name === body.field);
        if (!field) throw new NotFoundException('Identity not found');
        const allowed = ((item as { agentOrigins?: string[] }).agentOrigins ?? []).includes(origin);
        if (field.sensitive && !allowed) {
          throw agentForbidden(AGENT_ERROR_CODES.ORIGIN_MISMATCH, 'This field is released only on an origin allowed for this item');
        }
        const values = await this.secrets.readCurrentValues(id);
        const value = values[field.name];
        if (typeof value !== 'string' || value === '') throw new NotFoundException('Identity not found');
        return { value };
      },
    );
  }
}
