import { useCallback, useState } from 'react';
import type { BrokerToken, CreatedBrokerToken } from '@marinoscar/vault-contract/broker';
import { api } from '../../core/headless/http.js';

export type { BrokerToken, CreatedBrokerToken };

/** The state of a broker token, from its dates. */
export type BrokerTokenStatus = 'active' | 'expired' | 'revoked';

export function brokerTokenStatus(token: Pick<BrokerToken, 'expiresAt' | 'revokedAt'>, now = Date.now()): BrokerTokenStatus {
  if (token.revokedAt) return 'revoked';
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= now) return 'expired';
  return 'active';
}

export async function listBrokerTokens(): Promise<BrokerToken[]> {
  return api.get<BrokerToken[]>('/broker/tokens');
}

/** The one call that returns the token itself: it is never readable again. */
export async function createBrokerToken(body: { name: string; expiresInDays: number; secretIds?: string[] }): Promise<CreatedBrokerToken> {
  return api.post<CreatedBrokerToken>('/broker/tokens', body);
}

export async function revokeBrokerToken(id: string): Promise<void> {
  await api.post<void>(`/broker/tokens/${encodeURIComponent(id)}/revoke`);
}

/** A friendly message for a failed token call. */
export function brokerTokenErrorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'BROKER_TOKEN_SECRET_INVALID') return 'Choose only your own secrets that are allowed through the broker.';
  return err instanceof Error ? err.message : 'Something went wrong';
}

interface UseBrokerTokensResult {
  tokens: BrokerToken[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/** The caller's broker tokens (never a token value). */
export function useBrokerTokens(): UseBrokerTokensResult {
  const [tokens, setTokens] = useState<BrokerToken[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setTokens(await listBrokerTokens());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load broker tokens');
    } finally {
      setIsLoading(false);
    }
  }, []);
  return { tokens, isLoading, error, refresh };
}
