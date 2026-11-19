import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AGENT_AUDIT_ACTIONS,
  AGENT_CARD_FIELD_MAP,
  AGENT_ERROR_CODES,
  amountToMinor,
  minorToAmount,
  type AgentCardFillRequest,
  type AgentCardGrantRequestCreate,
  type AgentCardSummary,
} from '@marinoscar/vault-contract/agent';
import { normalizeOrigin, registrableDomainOfOrigin } from '@marinoscar/vault-contract/secrets';

import type { VaultAgentCardDeclineReason } from '../core/notification-data';
import { SecretsService } from '../secrets/secrets.service';
import { AgentNotifier, PAT_ACTOR_NAME } from './agent-notifier.service';
import { AgentCallPipeline, agentForbidden, type AgentAuditContext, type AgentCaller } from './agent-pipeline';
import { CardGrantStore, isGrantLive, type CardGrantRecord } from './card-grant-store';

/** The audit reasons of a card fill that notify the owner (`vault.agent_card_declined`). */
const DECLINE_REASONS: ReadonlySet<string> = new Set<VaultAgentCardDeclineReason>([
  'amount_exceeded',
  'currency_mismatch',
  'period_limit',
  'daily_cap',
  'grant_expired',
  'origin_mismatch',
  'security_code_not_granted',
]);

/**
 * The site a merchant origin is matched on: its registrable domain, or the origin itself for a host
 * without one (an IP address, `localhost`).
 *
 * @stability experimental
 */
export function merchantSiteOf(origin: string): string {
  return registrableDomainOfOrigin(origin) ?? origin;
}

/** The last four digits of a card number, or null. Never more. */
function last4Of(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);

/**
 * The card half of the agent rules (ADR-0003): list the opened cards with a live grant for a
 * merchant, release ONE field of a card under its grant, and ask the owner for a grant. Every call
 * runs through {@link AgentCallPipeline} behind both kill switches (`agentAccess.enabled`,
 * `agentAccess.cards.enabled`). Used through `AgentReleaseService` (in process and HTTP).
 *
 * @stability experimental
 */
@Injectable()
export class AgentCardsService {
  /** The clock; a test replaces it. */
  now: () => Date = () => new Date();

  constructor(
    private readonly secrets: SecretsService,
    private readonly pipeline: AgentCallPipeline,
    private readonly notifier: AgentNotifier,
    @Inject(CardGrantStore) private readonly store: CardGrantStore,
  ) {}

  private requireOrigin(input: string, name = 'origin'): string {
    const origin = normalizeOrigin(input);
    if (!origin) throw new BadRequestException(`${name} is not a valid https origin`);
    return origin;
  }

  private notFound(): NotFoundException {
    return new NotFoundException('Card not found');
  }

  /** `GET /cards?origin=`: opened cards with a live grant for the merchant site. Never a number or a code. */
  async cardsLookup(caller: AgentCaller, rawOrigin: string): Promise<AgentCardSummary[]> {
    const ctx: AgentAuditContext = {};
    return this.pipeline.run(caller, { action: AGENT_AUDIT_ACTIONS.CARD_LOOKUP, bucket: 'lookup', gate: 'cards' }, ctx, async () => {
      const origin = this.requireOrigin(rawOrigin);
      ctx.origin = origin;
      const site = merchantSiteOf(origin);
      const now = this.now();
      const cards = await this.secrets.listAgentOpenedSecrets(caller.userId, 'Card');
      const grants = (await this.store.listUnrevokedGrants(cards.map((card) => card.id))).filter(
        (grant) => grant.merchantSite === site && isGrantLive(grant, now),
      );
      const out: AgentCardSummary[] = [];
      for (const card of cards) {
        const grant = grants.find((g) => g.secretId === card.id);
        if (!grant) continue;
        const values = await this.secrets.readCurrentValues(card.id);
        out.push({
          id: card.id,
          name: card.name,
          brand: str(values.card_network),
          last4: last4Of(values.number),
          expMonth: str(values.exp_month),
          expYear: str(values.exp_year),
          grant: {
            maxAmount: minorToAmount(grant.maxAmountMinor),
            currency: grant.currency,
            includesSecurityCode: grant.includeSecurityCode,
            expiresAt: grant.expiresAt ? grant.expiresAt.toISOString() : null,
          },
        });
      }
      ctx.extra = { matches: out.length };
      return out;
    });
  }

  /**
   * The card `id` of the caller when it is opened and has a live grant at all; else the one 404.
   * Fills in the audit context as facts become known.
   */
  private async openedCard(caller: AgentCaller, id: string, ctx: AgentAuditContext) {
    ctx.secretId = id;
    const card = await this.secrets.findAgentOpenedSecret(caller.userId, id, 'Card');
    if (!card) throw this.notFound();
    const grants = await this.store.listUnrevokedGrants([id]);
    return { card, grants };
  }

  /** The grant of `grants` for `site` under the ADR-0003 order: expired is 403, none here but elsewhere is ORIGIN_MISMATCH. */
  private grantFor(grants: CardGrantRecord[], site: string, now: Date): CardGrantRecord {
    const live = grants.filter((grant) => isGrantLive(grant, now));
    if (live.length === 0 && !grants.some((grant) => grant.merchantSite === site)) throw this.notFound();
    const here = grants.filter((grant) => grant.merchantSite === site);
    const liveHere = here.find((grant) => isGrantLive(grant, now));
    if (liveHere) return liveHere;
    if (here.length > 0) {
      throw agentForbidden(AGENT_ERROR_CODES.CARD_GRANT_EXPIRED, 'The grant of this card for this merchant has expired');
    }
    throw agentForbidden(AGENT_ERROR_CODES.ORIGIN_MISMATCH, 'This card is not granted for this merchant');
  }

  /** `POST /cards/:id/fill`: ONE field of a granted card, within the grant's rules. */
  async cardFill(caller: AgentCaller, id: string, body: AgentCardFillRequest): Promise<{ value: string }> {
    const ctx: AgentAuditContext = { field: body.field, purpose: body.purpose, currency: body.currency };
    const amountMinor = amountToMinor(body.amount);
    ctx.amountMinor = amountMinor;
    let first = false;
    return this.pipeline.run(
      caller,
      { action: AGENT_AUDIT_ACTIONS.CARD_FILL, bucket: 'card_fill', gate: 'cards' },
      ctx,
      async () => {
        const { card, grants } = await this.openedCard(caller, id, ctx);
        const origin = this.requireOrigin(body.origin);
        ctx.origin = origin;
        ctx.secretName = card.name;
        const frameOrigin = body.frameOrigin !== undefined ? this.requireOrigin(body.frameOrigin, 'frameOrigin') : undefined;
        if (frameOrigin) ctx.frameOrigin = frameOrigin;
        const now = this.now();
        const grant = this.grantFor(grants, merchantSiteOf(origin), now);
        ctx.extra = { grantId: grant.id };
        if (frameOrigin && !grant.frameOrigins.includes(frameOrigin)) {
          throw agentForbidden(AGENT_ERROR_CODES.ORIGIN_MISMATCH, 'This payment frame is not accepted for this merchant');
        }
        if (body.currency !== grant.currency) {
          throw agentForbidden(AGENT_ERROR_CODES.CARD_CURRENCY_MISMATCH, 'The currency is not the grant currency');
        }
        if (amountMinor > grant.maxAmountMinor) {
          throw agentForbidden(AGENT_ERROR_CODES.CARD_AMOUNT_EXCEEDED, 'The amount is above the grant maximum');
        }
        if (body.field === 'securityCode' && !grant.includeSecurityCode) {
          throw agentForbidden(AGENT_ERROR_CODES.SECURITY_CODE_NOT_GRANTED, 'The grant does not include the security code');
        }
        const values = await this.secrets.readCurrentValues(id);
        const value = values[AGENT_CARD_FIELD_MAP[body.field]];
        if (typeof value !== 'string' || value === '') throw this.notFound();
        if (body.field === 'number') {
          const settings = await this.pipeline.loadSettings();
          const outcome = await this.store.recordRelease({
            grant,
            amountMinor,
            currency: body.currency,
            dailyCap: settings.cards.releasesPerCardPerDay,
            now,
          });
          if (!outcome.ok) {
            throw outcome.reason === 'period_limit'
              ? agentForbidden(AGENT_ERROR_CODES.CARD_PERIOD_LIMIT_REACHED, 'The grant period limit was reached')
              : agentForbidden(AGENT_ERROR_CODES.CARD_DAILY_CAP_REACHED, 'The daily release cap of this card was reached');
          }
          first = outcome.first;
        }
        return { value };
      },
      {
        afterAudit: async () => {
          if (first && ctx.secretId && ctx.secretName) {
            await this.notifier.cardFirstRelease(caller, this.facts(ctx));
          }
        },
        onDenied: async (reason) => {
          if (DECLINE_REASONS.has(reason) && ctx.secretId && ctx.secretName) {
            await this.notifier.cardDeclined(caller, this.facts(ctx), reason as VaultAgentCardDeclineReason);
          }
        },
      },
    );
  }

  private facts(ctx: AgentAuditContext) {
    return {
      secretId: ctx.secretId!,
      secretName: ctx.secretName!,
      origin: ctx.origin ?? null,
      amountMinor: ctx.amountMinor ?? 0,
      currency: ctx.currency ?? '',
    };
  }

  /**
   * `POST /cards/:id/grant-requests`: a pending request the owner approves or declines in Vault.
   * Returns an id and a status, never card data. A second request for the same card and merchant
   * site while one is pending returns the pending one (and does not notify again).
   */
  async requestGrant(caller: AgentCaller, id: string, body: AgentCardGrantRequestCreate): Promise<{ id: string; status: 'pending' | 'approved' | 'declined' }> {
    const amountMinor = amountToMinor(body.amount);
    const ctx: AgentAuditContext = { field: 'grant', purpose: 'purchase', amountMinor, currency: body.currency };
    let created: { id: string } | null = null;
    return this.pipeline.run(
      caller,
      { action: AGENT_AUDIT_ACTIONS.CARD_GRANT_REQUEST, bucket: 'write', gate: 'cards' },
      ctx,
      async () => {
        ctx.secretId = id;
        const card = await this.secrets.findAgentOpenedSecret(caller.userId, id, 'Card');
        if (!card) throw this.notFound();
        ctx.secretName = card.name;
        const origin = this.requireOrigin(body.origin);
        ctx.origin = origin;
        const site = merchantSiteOf(origin);
        const pending = await this.store.findPendingRequest(id, site);
        if (pending) {
          ctx.extra = { requestId: pending.id, duplicate: true };
          return { id: pending.id, status: pending.status };
        }
        const credential = caller.credential;
        const request = await this.store.createRequest({
          secretId: id,
          userId: caller.userId,
          origin,
          merchantSite: site,
          amountMinor,
          currency: body.currency,
          reason: body.reason,
          clientId: credential?.kind === 'oauth' ? credential.clientId : null,
          clientLabel: credential === undefined ? caller.clientLabel?.trim() ?? null : credential?.kind === 'pat' ? PAT_ACTOR_NAME : null,
        });
        created = { id: request.id };
        ctx.extra = { requestId: request.id };
        return { id: request.id, status: request.status };
      },
      {
        afterAudit: async () => {
          if (created && ctx.secretName) {
            await this.notifier.cardGrantRequested(caller, { ...this.facts(ctx), requestId: created.id, reason: body.reason });
          }
        },
      },
    );
  }
}
