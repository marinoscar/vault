import { BadRequestException, Injectable } from '@nestjs/common';
import type { AuthCredentialInfo } from '@marinoscar/platform-api/identity';
import {
  agentCardFillRequestSchema,
  agentCardGrantRequestCreateSchema,
  agentFillRequestSchema,
  agentIdentityFillRequestSchema,
  agentTotpRequestSchema,
  type AgentCardFillRequest,
  type AgentCardGrantRequestCreate,
  type AgentCardSummary,
  type AgentCredentialSummary,
  type AgentFillRequest,
  type AgentIdentityFillRequest,
  type AgentIdentitySummary,
  type AgentTotpRequest,
} from '@marinoscar/vault-contract/agent';
import type { z } from 'zod';

import { AgentCardsService } from './agent-cards.service';
import { AgentCredentialsService } from './agent-credentials.service';
import { AgentIdentityService } from './agent-identity.service';
import type { AgentCaller } from './agent-pipeline';

/**
 * Who asks, for every {@link AgentReleasePort} method.
 *
 * An embedding host (no HTTP, no OAuth) passes `userId` (the person the agent acts for) and
 * `clientLabel` (its own or its app's display name; it is audited, rate-limited on and shown to the
 * owner) and leaves `credential` out. The HTTP controllers pass the request's credential, which
 * must be an `oat_` or `pat_` token.
 *
 * @stability experimental
 */
export interface AgentReleaseContext {
  userId: string;
  clientLabel: string;
  credential?: AuthCredentialInfo | null;
}

/** Input of {@link AgentReleasePort.lookup} and the other lookups. @stability experimental */
export interface AgentReleaseLookupInput extends AgentReleaseContext {
  origin: string;
}

/** Input of {@link AgentReleasePort.fill}. @stability experimental */
export type AgentReleaseFillInput = AgentReleaseContext & { secretId: string } & AgentFillRequest;

/** Input of {@link AgentReleasePort.totp}. @stability experimental */
export type AgentReleaseTotpInput = AgentReleaseContext & { secretId: string } & AgentTotpRequest;

/** Input of {@link AgentReleasePort.cardFill}. @stability experimental */
export type AgentReleaseCardFillInput = AgentReleaseContext & { cardId: string } & AgentCardFillRequest;

/** Input of {@link AgentReleasePort.cardGrantRequest}. @stability experimental */
export type AgentReleaseCardGrantRequestInput = AgentReleaseContext & { cardId: string } & AgentCardGrantRequestCreate;

/** Input of {@link AgentReleasePort.identityFill}. @stability experimental */
export type AgentReleaseIdentityFillInput = AgentReleaseContext & { identityId: string } & AgentIdentityFillRequest;

/**
 * The agent release rules as an in-process service (ADR-0002, ADR-0003): what a host that embeds
 * the Vault packages calls instead of the HTTP API. Every method enforces exactly what the matching
 * route does (kill switches, per-item opt-in, origin binding, merchant grants and their limits,
 * one field per call, rate limits, audit and owner notifications); the HTTP controllers call the
 * same implementation. Errors are the same Nest `HttpException`s the routes answer with (`404`,
 * `403` with a `code`, `429` with `Retry-After`).
 *
 * Inject it with {@link AGENT_RELEASE_PORT} (or the class {@link AgentReleaseService}).
 *
 * @extensionPoint token
 * @stability experimental
 */
export interface AgentReleasePort {
  /** Logins opened to agents that match `origin` (exact first). Never a sensitive value. */
  lookup(input: AgentReleaseLookupInput): Promise<AgentCredentialSummary[]>;
  /** ONE field (`username` or `password`) of a login, on one of its exact origins. */
  fill(input: AgentReleaseFillInput): Promise<{ value: string }>;
  /** The current one-time code of a login, on one of its exact origins. */
  totp(input: AgentReleaseTotpInput): Promise<{ code: string; expiresAt: string }>;
  /** Opened cards with a live grant for the merchant of `origin`. Never a number or a code. */
  cardsLookup(input: AgentReleaseLookupInput): Promise<AgentCardSummary[]>;
  /** ONE field of a granted card, within the grant's amount, currency, period and frame rules. */
  cardFill(input: AgentReleaseCardFillInput): Promise<{ value: string }>;
  /** Ask the owner for a grant; returns an id and a status, never card data. */
  cardGrantRequest(input: AgentReleaseCardGrantRequestInput): Promise<{ id: string; status: 'pending' | 'approved' | 'declined' }>;
  /** Opened identity items and the labels of their fields. Never a value. */
  identityLookup(input: AgentReleaseLookupInput): Promise<AgentIdentitySummary[]>;
  /** ONE field of an identity item; a sensitive one only on an allowed origin. */
  identityFill(input: AgentReleaseIdentityFillInput): Promise<{ value: string }>;
}

/**
 * The DI token of {@link AgentReleasePort}, bound to {@link AgentReleaseService} by `VaultApiModule`.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const AGENT_RELEASE_PORT = Symbol.for('@marinoscar/vault/AGENT_RELEASE_PORT');

/** Parses an in-process body with the route's schema; the same 400 the route's pipe answers. */
function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      message: 'Validation failed',
      // Paths and messages only: never the submitted value.
      errors: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }
  return result.data;
}

/**
 * The one implementation of {@link AgentReleasePort}. HTTP controllers and embedded hosts call it.
 *
 * @stability experimental
 */
@Injectable()
export class AgentReleaseService implements AgentReleasePort {
  constructor(
    private readonly credentials: AgentCredentialsService,
    private readonly cards: AgentCardsService,
    private readonly identity: AgentIdentityService,
  ) {}

  private caller(input: AgentReleaseContext): AgentCaller {
    return input.credential === undefined
      ? { userId: input.userId, clientLabel: input.clientLabel }
      : { userId: input.userId, credential: input.credential, clientLabel: input.clientLabel };
  }

  async lookup(input: AgentReleaseLookupInput): Promise<AgentCredentialSummary[]> {
    return this.credentials.lookup(this.caller(input), input.origin);
  }

  async fill(input: AgentReleaseFillInput): Promise<{ value: string }> {
    const body = parse(agentFillRequestSchema, { field: input.field, origin: input.origin, purpose: input.purpose });
    return this.credentials.fill(this.caller(input), input.secretId, body);
  }

  async totp(input: AgentReleaseTotpInput): Promise<{ code: string; expiresAt: string }> {
    const body = parse(agentTotpRequestSchema, { origin: input.origin, purpose: input.purpose });
    return this.credentials.totp(this.caller(input), input.secretId, body);
  }

  async cardsLookup(input: AgentReleaseLookupInput): Promise<AgentCardSummary[]> {
    return this.cards.cardsLookup(this.caller(input), input.origin);
  }

  async cardFill(input: AgentReleaseCardFillInput): Promise<{ value: string }> {
    const body = parse(agentCardFillRequestSchema, {
      field: input.field,
      origin: input.origin,
      ...(input.frameOrigin !== undefined ? { frameOrigin: input.frameOrigin } : {}),
      amount: input.amount,
      currency: input.currency,
      purpose: input.purpose,
    });
    return this.cards.cardFill(this.caller(input), input.cardId, body);
  }

  async cardGrantRequest(input: AgentReleaseCardGrantRequestInput): Promise<{ id: string; status: 'pending' | 'approved' | 'declined' }> {
    const body = parse(agentCardGrantRequestCreateSchema, {
      origin: input.origin,
      amount: input.amount,
      currency: input.currency,
      reason: input.reason,
    });
    return this.cards.requestGrant(this.caller(input), input.cardId, body);
  }

  async identityLookup(input: AgentReleaseLookupInput): Promise<AgentIdentitySummary[]> {
    return this.identity.identityLookup(this.caller(input), input.origin);
  }

  async identityFill(input: AgentReleaseIdentityFillInput): Promise<{ value: string }> {
    const body = parse(agentIdentityFillRequestSchema, { field: input.field, origin: input.origin, purpose: input.purpose });
    return this.identity.identityFill(this.caller(input), input.identityId, body);
  }
}
