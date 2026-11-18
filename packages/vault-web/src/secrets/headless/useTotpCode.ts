import { useCallback, useEffect, useRef, useState } from 'react';
import { getSecretTotp, type SecretTotpCode } from '../../core/headless/api.js';

export type TotpStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UseTotpCodeResult {
  status: TotpStatus;
  /** The current code (digits only), or null until shown. Held in state only, never stored. */
  code: string | null;
  period: number;
  /** Milliseconds until the code expires; 0 when none. */
  remainingMs: number;
  /** A friendly message when `status` is `error`. */
  error: string | null;
  /** Fetch a code now (the "Show code" action). */
  show: () => void;
  /** Forget the code and stop refreshing. */
  hide: () => void;
}

/** "123456" -> "123 456"; "12345678" -> "1234 5678". */
export function groupTotpCode(code: string): string {
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
  if (code.length % 3 === 0) return code.replace(/(.{3})(?=.)/g, '$1 ');
  const half = Math.ceil(code.length / 2);
  return `${code.slice(0, half)} ${code.slice(half)}`;
}

function describeError(err: unknown): string {
  if ((err as { status?: number } | null)?.status === 404) {
    return 'This secret has no authenticator key. Add one by editing the secret.';
  }
  if ((err as { status?: number } | null)?.status === 403) {
    return 'You cannot read codes for this secret.';
  }
  return 'Could not get a code. Try again.';
}

const TICK_MS = 250;

/**
 * The on-demand authenticator code of one secret. Nothing is fetched until
 * {@link UseTotpCodeResult.show}; the code lives in component state only, is
 * re-fetched when it expires while the page is visible, and is dropped on
 * unmount or hide. A hidden tab does not refresh; it catches up when shown.
 */
export function useTotpCode(secretId: string): UseTotpCodeResult {
  const [status, setStatus] = useState<TotpStatus>('idle');
  const [data, setData] = useState<SecretTotpCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const wanted = useRef(false);
  const inFlight = useRef(false);
  // Synchronous copy of the expiry so a tick never acts on a stale (already replaced) code.
  const expiryRef = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      wanted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await getSecretTotp(secretId);
      if (!mounted.current || !wanted.current) return;
      expiryRef.current = new Date(result.expiresAt).getTime();
      setData(result);
      setError(null);
      setNow(Date.now());
      setStatus('ready');
    } catch (err) {
      if (!mounted.current || !wanted.current) return;
      wanted.current = false;
      expiryRef.current = 0;
      setData(null);
      setError(describeError(err));
      setStatus('error');
    } finally {
      inFlight.current = false;
    }
  }, [secretId]);

  const show = useCallback(() => {
    wanted.current = true;
    setError(null);
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    void load();
  }, [load]);

  const hide = useCallback(() => {
    wanted.current = false;
    expiryRef.current = 0;
    setData(null);
    setError(null);
    setStatus('idle');
  }, []);

  const expiresMs = data ? new Date(data.expiresAt).getTime() : 0;

  // Tick for the countdown and refresh when the code has expired and the page is visible.
  useEffect(() => {
    if (!data) return undefined;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t >= expiryRef.current && document.visibilityState !== 'hidden') void load();
    };
    const timer = setInterval(tick, TICK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [data, load]);

  return {
    status,
    code: data ? data.code : null,
    period: data?.period ?? 30,
    remainingMs: data ? Math.max(0, expiresMs - now) : 0,
    error,
    show,
    hide,
  };
}
