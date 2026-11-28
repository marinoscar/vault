import { isMcpExcludedType } from '../secrets/assistant-reveal-types';

/**
 * Which secret types the credential broker can use, and which field holds the key (ADR-0006
 * decision 3).
 *
 * Supported: the system `API Key`, `Token` and `Service Key`, and a custom type with at least one
 * sensitive string field (exactly one, or the caller names one). Every other system type (Credential,
 * Card, Identity, Passport, ID Document, Note, ...) and every type with a cvv-like field is not.
 */

/** The system types the broker accepts (lower case). */
export const BROKER_SYSTEM_TYPE_NAMES: readonly string[] = ['api key', 'token', 'service key'];

interface TypeLike {
  name: string;
  isSystem?: boolean;
  fields: unknown;
}

interface FieldLike {
  name?: unknown;
  type?: unknown;
  sensitive?: unknown;
}

/** Names of the sensitive string fields of `type`. */
export function sensitiveStringFields(type: { fields: unknown }): string[] {
  const fields = Array.isArray(type.fields) ? (type.fields as FieldLike[]) : [];
  return fields
    .filter((f) => f && typeof f.name === 'string' && f.sensitive === true && (f.type === undefined || f.type === 'string'))
    .map((f) => f.name as string);
}

/** The outcome of {@link resolveBrokerField}. */
export type BrokerFieldResolution =
  | { ok: true; field: string }
  | { ok: false; code: 'BROKER_UNSUPPORTED_TYPE' | 'BROKER_FIELD_INVALID'; message: string };

/**
 * The field the broker injects for a secret of `type`: `requested` when it names a sensitive string
 * field of the type, else the type's only one.
 */
export function resolveBrokerField(type: TypeLike, requested?: string | null): BrokerFieldResolution {
  const unsupported = (message: string): BrokerFieldResolution => ({ ok: false, code: 'BROKER_UNSUPPORTED_TYPE', message });
  if (isMcpExcludedType(type)) return unsupported('This secret type cannot be used through the broker');
  if (type.isSystem === true && !BROKER_SYSTEM_TYPE_NAMES.includes(type.name.toLowerCase())) {
    return unsupported('Only an API Key, Token, Service Key or a custom type with a sensitive field can be used through the broker');
  }
  const sensitive = sensitiveStringFields(type);
  if (sensitive.length === 0) return unsupported('This secret type has no sensitive field to use as a key');
  if (requested) {
    return sensitive.includes(requested)
      ? { ok: true, field: requested }
      : { ok: false, code: 'BROKER_FIELD_INVALID', message: `"${requested}" is not a sensitive field of this secret type` };
  }
  if (sensitive.length === 1) return { ok: true, field: sensitive[0]! };
  return { ok: false, code: 'BROKER_FIELD_INVALID', message: `Name the field to use: ${sensitive.join(', ')}` };
}
