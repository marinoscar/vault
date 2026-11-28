import { UnprocessableEntityException } from '@nestjs/common';
import { BROKER_ERROR_CODES, MAX_BROKER_ORIGINS, brokerInjectionSchema, type BrokerInjection, type UpdateBrokerAccess } from '@marinoscar/vault-contract/broker';

import { normalizeBrokerOrigin } from './broker-origin';
import { resolveBrokerField } from './broker-types';

/** What the opt-in route works from: the secret's current broker state and its type. */
export interface BrokerAccessSnapshot {
  brokerAccess?: boolean | null;
  brokerOrigins?: string[] | null;
  brokerInjection?: unknown;
  brokerField?: string | null;
  type: { name: string; isSystem?: boolean; fields: unknown };
}

/** The columns an enable writes. */
export interface BrokerAccessEnable {
  brokerAccess: true;
  brokerOrigins: string[];
  brokerInjection: BrokerInjection | null;
  brokerField: string | null;
}

function unprocessable(code: string, message: string): UnprocessableEntityException {
  return new UnprocessableEntityException({ code, message });
}

/**
 * Validates an ENABLE request against the secret and returns the columns to write (ADR-0006
 * decision 3): a supported type and field (`BROKER_UNSUPPORTED_TYPE`, `BROKER_FIELD_INVALID`), at
 * least one origin (`BROKER_ORIGINS_REQUIRED`) and every origin an exact public HTTPS origin
 * (`BROKER_ORIGIN_INVALID`) and a valid injection (`BROKER_INJECTION_INVALID`). Origins, injection
 * and field not sent keep their stored values.
 * Turning the broker OFF needs none of this and is not routed through here.
 */
export function prepareBrokerEnable(existing: BrokerAccessSnapshot, dto: UpdateBrokerAccess): BrokerAccessEnable {
  const requestedField = dto.field ?? existing.brokerField ?? null;
  const resolved = resolveBrokerField(existing.type, requestedField);
  if (!resolved.ok) throw unprocessable(BROKER_ERROR_CODES[resolved.code], resolved.message);

  const rawOrigins = dto.origins ?? existing.brokerOrigins ?? [];
  const origins: string[] = [];
  for (const raw of rawOrigins) {
    const checked = normalizeBrokerOrigin(raw);
    if (!checked.ok) {
      throw unprocessable(BROKER_ERROR_CODES.BROKER_ORIGIN_INVALID, `"${raw.slice(0, 200)}" is not an allowed origin: ${checked.reason}`);
    }
    if (!origins.includes(checked.origin)) origins.push(checked.origin);
  }
  if (origins.length === 0) throw unprocessable(BROKER_ERROR_CODES.BROKER_ORIGINS_REQUIRED, 'Enter at least one allowed origin (https://host[:port])');
  if (origins.length > MAX_BROKER_ORIGINS) throw unprocessable(BROKER_ERROR_CODES.BROKER_ORIGIN_INVALID, `At most ${MAX_BROKER_ORIGINS} origins`);

  let injection: BrokerInjection | null = null;
  const stored = dto.injection ?? existing.brokerInjection ?? null;
  if (stored !== null) {
    const parsed = brokerInjectionSchema.safeParse(stored);
    if (!parsed.success) throw unprocessable(BROKER_ERROR_CODES.BROKER_INJECTION_INVALID, 'The stored injection is not valid; send a new one');
    injection = parsed.data;
  }

  return { brokerAccess: true, brokerOrigins: origins, brokerInjection: injection, brokerField: dto.field ?? existing.brokerField ?? null };
}

/** `a` and `b` as the same JSON value (key order ignored for the flat injection objects). */
export function sameInjection(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v && typeof v === 'object' ? JSON.stringify(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y))) : JSON.stringify(v ?? null));
  return norm(a) === norm(b);
}
