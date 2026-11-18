import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuthCredentialInfo } from '@marinoscar/platform-api/identity';

import {
  VAULT_AGENT_CREDENTIAL_CHANGED_EVENT,
  VAULT_AGENT_CREDENTIAL_USED_EVENT,
  VAULT_AGENT_NEW_APP_EVENT,
  type VaultAgentCredentialChangedNotificationData,
  type VaultAgentCredentialUsedNotificationData,
  type VaultAgentNewAppNotificationData,
} from '../core/notification-data';
import { VAULT_NOTIFY, VAULT_PRISMA, type VaultNotifyPort, type VaultPrismaClient } from '../ports';

/** The name shown for a personal access token (it has no client). */
export const PAT_ACTOR_NAME = 'Personal access token';
const UNKNOWN_APP_NAME = 'An app';
/** A client's name is cached this long so a burst of fills costs one lookup. */
const CLIENT_NAME_TTL_MS = 60_000;
/** Fills of one login by one app fold into one bell row within this window. */
export const AGENT_USED_FOLD_WINDOW_MS = 60 * 60 * 1000;

/** Who acted, as far as the owner is told. */
export interface AgentNotifyCaller {
  userId: string;
  credential: AuthCredentialInfo | null;
}

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

  constructor(
    @Inject(VAULT_PRISMA) private readonly prisma: VaultPrismaClient,
    @Inject(VAULT_NOTIFY) private readonly notifications: VaultNotifyPort,
  ) {}

  /** The stable key of the calling app: the OAuth client's row id (as on its grants), or the PAT id. */
  private actorKey(caller: AgentNotifyCaller): { kind: 'oauth' | 'pat'; key: string } | null {
    const credential = caller.credential;
    if (credential?.kind === 'oauth') return { kind: 'oauth', key: credential.clientId };
    if (credential?.kind === 'pat') return { kind: 'pat', key: credential.tokenId };
    return null;
  }

  private async actorName(caller: AgentNotifyCaller): Promise<string> {
    const actor = this.actorKey(caller);
    if (!actor) return UNKNOWN_APP_NAME;
    if (actor.kind === 'pat') return PAT_ACTOR_NAME;
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
            { meta: { path: [actor.kind === 'oauth' ? 'clientId' : 'tokenId'], equals: actor.key } },
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

  private appUrl(): { appUrl?: string } {
    return process.env.APP_URL ? { appUrl: process.env.APP_URL } : {};
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
}
