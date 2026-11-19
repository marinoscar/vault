import type {
  CardGrant,
  CardGrantRequest,
  CardGrantRequestStatus,
  CreateCardGrant,
} from '@marinoscar/vault-contract/agent';

import { api } from '../../core/headless/http.js';

export type { CardGrant, CardGrantRequest, CardGrantRequestStatus, CreateCardGrant };

/**
 * The owner's merchant grants of a card and the requests agents made (ADR-0003). Every write needs
 * the owner's browser session; the API refuses a token with `OWNER_SESSION_REQUIRED`. Nothing here
 * ever carries a card number or code.
 */

/** Every grant of a card: active first, then expired and revoked. */
export function listCardGrants(secretId: string): Promise<CardGrant[]> {
  return api.get<CardGrant[]>(`/secrets/${secretId}/card-grants`);
}

/** Allows agents to use the card at one merchant. */
export function createCardGrant(secretId: string, body: CreateCardGrant): Promise<CardGrant> {
  return api.post<CardGrant>(`/secrets/${secretId}/card-grants`, body);
}

/** Revokes a grant (agents can no longer use the card at that merchant). */
export function revokeCardGrant(secretId: string, grantId: string): Promise<CardGrant> {
  return api.delete<CardGrant>(`/secrets/${secretId}/card-grants/${grantId}`);
}

/** The requests agents made for a card, newest first. */
export function listCardGrantRequests(secretId: string, status?: CardGrantRequestStatus): Promise<CardGrantRequest[]> {
  return api.get<CardGrantRequest[]>(`/secrets/${secretId}/card-grant-requests${status ? `?status=${status}` : ''}`);
}

/** Approves a request: creates exactly the requested grant. */
export function approveCardGrantRequest(
  secretId: string,
  requestId: string,
): Promise<{ request: CardGrantRequest; grant: CardGrant }> {
  return api.post<{ request: CardGrantRequest; grant: CardGrant }>(
    `/secrets/${secretId}/card-grant-requests/${requestId}/approve`,
    {},
  );
}

/** Declines a request. */
export function declineCardGrantRequest(secretId: string, requestId: string): Promise<CardGrantRequest> {
  return api.post<CardGrantRequest>(`/secrets/${secretId}/card-grant-requests/${requestId}/decline`, {});
}

/** `42.50 USD`. */
export function formatGrantAmount(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
}

/** A one-line summary of a grant's limits, e.g. `Up to 100.00 USD per purchase · 3 per month`. */
export function describeGrantLimits(grant: Pick<CardGrant, 'maxAmount' | 'currency' | 'periodLimit'>): string {
  const parts = [`Up to ${formatGrantAmount(grant.maxAmount, grant.currency)} per purchase`];
  const limit = grant.periodLimit;
  if (limit) {
    const per = limit.period === 'day' ? 'day' : 'month';
    if (limit.maxReleases !== null) parts.push(`${limit.maxReleases} per ${per}`);
    if (limit.maxAmount !== null) parts.push(`${formatGrantAmount(limit.maxAmount, grant.currency)} per ${per}`);
  }
  return parts.join(' · ');
}

/** A friendly message for a failed grant action. */
export function cardGrantErrorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  switch (code) {
    case 'CARD_GRANT_EXISTS':
      return 'This card already has a live permission for that shop. Revoke it first.';
    case 'CARD_GRANT_REQUEST_NOT_PENDING':
      return 'This request was already approved or declined.';
    case 'OWNER_SESSION_REQUIRED':
      return 'Sign in to Vault to change what agents may do with this card.';
    default:
      return err instanceof Error ? err.message : 'Something went wrong';
  }
}
