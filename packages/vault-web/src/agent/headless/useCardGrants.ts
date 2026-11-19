import { useCallback, useEffect, useState } from 'react';

import {
  approveCardGrantRequest,
  createCardGrant,
  declineCardGrantRequest,
  listCardGrantRequests,
  listCardGrants,
  revokeCardGrant,
  type CardGrant,
  type CardGrantRequest,
  type CreateCardGrant,
} from './cardGrants.js';

export interface UseCardGrantsResult {
  grants: CardGrant[];
  /** Pending requests only, newest first. */
  requests: CardGrantRequest[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (body: CreateCardGrant) => Promise<void>;
  revoke: (grantId: string) => Promise<void>;
  approve: (requestId: string) => Promise<void>;
  decline: (requestId: string) => Promise<void>;
}

/**
 * The merchant grants and the pending grant requests of one card (ADR-0003). Every action reloads
 * both lists, so the use counters and statuses are the server's. Actions throw; the caller shows
 * the message (`cardGrantErrorMessage`).
 */
export function useCardGrants(secretId: string | undefined): UseCardGrantsResult {
  const [grants, setGrants] = useState<CardGrant[]>([]);
  const [requests, setRequests] = useState<CardGrantRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!secretId) return;
    setLoading(true);
    try {
      const [nextGrants, nextRequests] = await Promise.all([
        listCardGrants(secretId),
        listCardGrantRequests(secretId, 'pending'),
      ]);
      setGrants(nextGrants);
      setRequests(nextRequests);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the agent permissions of this card');
    } finally {
      setLoading(false);
    }
  }, [secretId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = useCallback(
    async (work: () => Promise<unknown>) => {
      await work();
      await refresh();
    },
    [refresh],
  );

  return {
    grants,
    requests,
    loading,
    error,
    refresh,
    create: (body) => act(() => createCardGrant(secretId!, body)),
    revoke: (grantId) => act(() => revokeCardGrant(secretId!, grantId)),
    approve: (requestId) => act(() => approveCardGrantRequest(secretId!, requestId)),
    decline: (requestId) => act(() => declineCardGrantRequest(secretId!, requestId)),
  };
}
