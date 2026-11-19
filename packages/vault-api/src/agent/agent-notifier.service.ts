import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { AuthCredentialInfo } from '@marinoscar/platform-api/identity';

import {
  VAULT_AGENT_CARD_DECLINED_EVENT,
  VAULT_AGENT_CARD_FIRST_RELEASE_EVENT,
  VAULT_AGENT_CARD_GRANT_REQUESTED_EVENT,
  VAULT_AGENT_CREDENTIAL_CHANGED_EVENT,
  VAULT_AGENT_CREDENTIAL_USED_EVENT,
  VAULT_AGENT_NEW_APP_EVENT,
  type VaultAgentCredentialChangedNotificationData,
  type VaultAgentCredentialUsedNotificationData,
  type VaultAgentNewAppNotificationData,
  type VaultAgentCardDeclineReason,
  type VaultAgentCardDeclinedNotificationData,
  type VaultAgentCardGrantRequestedNotificationData,
  type VaultAgentCardNotificationData,
} from '../core/notification-data';
import {
  hostAppUrl,
  VAULT_HOST,
  VAULT_NOTIFY,
  VAULT_PRISMA,
  type VaultHostConfig,
  type VaultNotifyPort,
  type VaultPrismaClient,
} from '../ports';

/** The name shown for a personal access token (it has no client). */
export const PAT_ACTOR_NAME = 'Personal access token';
const UNKNOWN_APP_NAME = 'An app';
/** A client's name is cached this long so a burst of fills costs one lookup. */
const CLIENT_NAME_TTL_MS = 60_000;
/** Fills of one login by one app fold into one bell row within this window. */
export const AGENT_USED_FOLD_WINDOW_MS = 60 * 60 * 1000;

/** Who acted, as far as the owner is told. `credential` absent: an in-process host named by `clientLabel`. */
export interface AgentNotifyCaller {
  userId: string;
  credential?: AuthCredentialInfo | null;
  clientLabel?: string;
}

/** The facts of a card notification. Never a number, last four, code or expiry. */
export interface AgentCardNotifyFacts {
  secretId: string;
  secretName: string;
  origin: string | null;
  amountMinor: number;
  currency: string;
}

/** Declined-fill notifications of one card, reason and merchant are sent at most once per this window. */
export const AGENT_CARD_DECLINED_THROTTLE_MS = 60 * 60 * 1000;

/** The facts of one successful call the notifications are built from. Never a value. */
export interface AgentNotifyFacts {
  secretId: string;
  secretName: string;
  origin: string | null;
}

/**
 * Raises the agent notifications (E14.7): `vault.agent_credential_changed` (create and rotate),
 * `vault.agent_new_app` (first successful fill by an app) and `vault.agent_credential_used` (every
 * successful fill and totp, folded in the bell).
 *
 * Every method is called AFTER the agent call's audit row was written and the work committed, outside
 * any `$transaction`, and never throws: a mail or database problem here cannot change a call's result.
 * Payloads carry names, ids and the origin; never a password, a code, a seed or a token.
 *
 * @stability experimental
 */
@Injectable()
export class AgentNotifier {
  private readonly logger = new Logger(AgentNotifier.name);
  private readonly clientNames = new Map<string, { name: string; expires: number }>();
  private readonly declinedSent = new Map<string, number>();

  /** The clock; a test replaces it. */
  now: () => number = () => Date.now();

  constructor(
    @Inject(VAULT_PRISMA) private readonly prisma: VaultPrismaClient,
    @Inject(VAULT_NOTIFY) private readonly notifications: VaultNotifyPort,
    @Optional() @Inject(VAULT_HOST) private readonly host?: VaultHostConfig,
  ) {}

  /** The stable key of the calling app: the OAuth client's row id (as on its grants), or the PAT id. */
  private actorKey(caller: AgentNotifyCaller): { kind: 'oauth' | 'pat' | 'embedded'; key: string } | null {
    const credential = caller.credential;
    if (credential?.kind === 'oauth') return { kind: 'oauth', key: credential.clientId };
    if (credential?.kind === 'pat') return { kind: 'pat', key: credential.tokenId };
    if (credential === undefined && caller.clientLabel?.trim()) return { kind: 'embedded', key: caller.clientLabel.trim() };
    return null;
  }

  private async actorName(caller: AgentNotifyCaller): Promise<string> {
    const actor = this.actorKey(caller);
    if (!actor) return UNKNOWN_APP_NAME;
    if (actor.kind === 'pat') return PAT_ACTOR_NAME;
    if (actor.kind === 'embedded') return actor.key;
    const cached = this.clientNames.get(actor.key);
    if (cached && cached.expires > Date.now()) return cached.name;
    const row = await this.prisma.oAuthClient.findUnique({ where: { id: actor.key }, select: { name: true } });
    const name = row?.name?.trim() || UNKNOWN_APP_NAME;
    this.clientNames.set(actor.key, { name, expires: Date.now() + CLIENT_NAME_TTL_MS });
    return name;
  }

  /**
   * True when this app (client or PAT) has no successful fill in the user's trail yet. Call it BEFORE
   * the current call's audit row is written, or the call counts as its own predecessor.
   */
  async isFirstFill(caller: AgentNotifyCaller, fillAction: string): Promise<boolean> {
    try {
      const actor = this.actorKey(caller);
      if (!actor) return false;
      const prior = await this.prisma.auditEvent.findFirst({
        where: {
          actorUserId: caller.userId,
          action: fillAction,
          AND: [
            { meta: { path: ['result'], equals: 'ok' } },
            { meta: { path: [actor.kind === 'oauth' ? 'clientId' : actor.kind === 'pat' ? 'tokenId' : 'clientLabel'], equals: actor.key } },
          ],
        },
        select: { id: true },
      });
      return prior === null;
    } catch (error) {
      this.logger.warn(`New-app check failed: ${(error as Error)?.name}`);
      return false;
    }
  }

  /** The call-to-action base URL from the host's `VAULT_HOST` binding, read on every use; none when unbound. */
  private appUrl(): { appUrl?: string } {
    return hostAppUrl(this.host);
  }

  /** `vault.agent_credential_changed`: a login was saved (`created`) or its password changed (`rotated`). */
  async credentialChanged(caller: AgentNotifyCaller, change: 'created' | 'rotated', facts: AgentNotifyFacts): Promise<void> {
    try {
      const actor = this.actorKey(caller);
      if (!actor) return;
      const data: VaultAgentCredentialChangedNotificationData = {
        change,
        clientName: await this.actorName(caller),
        credentialKind: actor.kind,
        ...facts,
        ...this.appUrl(),
      };
      await this.notifications.notify(VAULT_AGENT_CREDENTIAL_CHANGED_EVENT, caller.userId, data);
    } catch (error) {
      this.logger.warn(`credential_changed notification failed: ${(error as Error)?.name}`);
    }
  }

  /** `vault.agent_new_app`: the first successful fill by this app. */
  async newApp(caller: AgentNotifyCaller, facts: AgentNotifyFacts): Promise<void> {
    try {
      const actor = this.actorKey(caller);
      if (!actor) return;
      const data: VaultAgentNewAppNotificationData = {
        clientName: await this.actorName(caller),
        credentialKind: actor.kind,
        ...facts,
        ...this.appUrl(),
      };
      await this.notifications.notify(VAULT_AGENT_NEW_APP_EVENT, caller.userId, data);
    } catch (error) {
      this.logger.warn(`new_app notification failed: ${(error as Error)?.name}`);
    }
  }

  /** `vault.agent_credential_used`: a successful fill or totp, folded per (login, app) in the bell. */
  async credentialUsed(caller: AgentNotifyCaller, action: 'fill' | 'totp', facts: AgentNotifyFacts): Promise<void> {
    try {
      const actor = this.actorKey(caller);
      if (!actor) return;
      const data: VaultAgentCredentialUsedNotificationData = {
        action,
        clientName: await this.actorName(caller),
        credentialKind: actor.kind,
        ...facts,
      };
      await this.notifications.notifyCounted(VAULT_AGENT_CREDENTIAL_USED_EVENT, caller.userId, data as unknown as Record<string, unknown>, {
        windowMs: AGENT_USED_FOLD_WINDOW_MS,
        match: { secretId: facts.secretId, app: actor.key },
      });
    } catch (error) {
      this.logger.warn(`credential_used notification failed: ${(error as Error)?.name}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Cards (ADR-0003)
  // ---------------------------------------------------------------------------

  private async cardData(caller: AgentNotifyCaller, facts: AgentCardNotifyFacts): Promise<VaultAgentCardNotificationData | null> {
    const actor = this.actorKey(caller);
    if (!actor) return null;
    return {
      clientName: await this.actorName(caller),
      credentialKind: actor.kind,
      secretId: facts.secretId,
      secretName: facts.secretName,
      origin: facts.origin,
      amount: (facts.amountMinor / 100).toFixed(2),
      currency: facts.currency,
      ...this.appUrl(),
    };
  }

  /** `vault.agent_card_grant_requested`: an app asks the owner to allow a card at a shop. */
  async cardGrantRequested(caller: AgentNotifyCaller, facts: AgentCardNotifyFacts & { requestId: string; reason: string }): Promise<void> {
    try {
      const base = await this.cardData(caller, facts);
      if (!base) return;
      const data: VaultAgentCardGrantRequestedNotificationData = { ...base, requestId: facts.requestId, reason: facts.reason };
      await this.notifications.notify(VAULT_AGENT_CARD_GRANT_REQUESTED_EVENT, caller.userId, data);
    } catch (error) {
      this.logger.warn(`card_grant_requested notification failed: ${(error as Error)?.name}`);
    }
  }

  /** `vault.agent_card_first_release`: the first release of a card under a grant. */
  async cardFirstRelease(caller: AgentNotifyCaller, facts: AgentCardNotifyFacts): Promise<void> {
    try {
      const data = await this.cardData(caller, facts);
      if (!data) return;
      await this.notifications.notify(VAULT_AGENT_CARD_FIRST_RELEASE_EVENT, caller.userId, data);
    } catch (error) {
      this.logger.warn(`card_first_release notification failed: ${(error as Error)?.name}`);
    }
  }

  /**
   * `vault.agent_card_declined`: Vault refused a card fill by a grant rule. At most once per card,
   * reason and merchant per {@link AGENT_CARD_DECLINED_THROTTLE_MS} (in process memory).
   */
  async cardDeclined(caller: AgentNotifyCaller, facts: AgentCardNotifyFacts, reason: VaultAgentCardDeclineReason): Promise<void> {
    try {
      const key = `${caller.userId}:${facts.secretId}:${reason}:${facts.origin ?? ''}`;
      const now = this.now();
      const last = this.declinedSent.get(key);
      if (last !== undefined && now - last < AGENT_CARD_DECLINED_THROTTLE_MS) return;
      if (this.declinedSent.size > 5_000) {
        for (const [k, at] of this.declinedSent) if (now - at >= AGENT_CARD_DECLINED_THROTTLE_MS) this.declinedSent.delete(k);
      }
      this.declinedSent.set(key, now);
      const base = await this.cardData(caller, facts);
      if (!base) return;
      const data: VaultAgentCardDeclinedNotificationData = { ...base, reason };
      await this.notifications.notify(VAULT_AGENT_CARD_DECLINED_EVENT, caller.userId, data);
    } catch (error) {
      this.logger.warn(`card_declined notification failed: ${(error as Error)?.name}`);
    }
  }
}
