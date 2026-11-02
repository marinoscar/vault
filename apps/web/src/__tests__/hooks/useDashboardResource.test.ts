import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useDashboardResource } from '../../hooks/useDashboardResource';

describe('useDashboardResource', () => {
  it('does not fetch while disabled and reports idle', () => {
    const fetcher = vi.fn().mockResolvedValue(1);
    const { result } = renderHook(() => useDashboardResource(fetcher, false));

    expect(result.current.status).toBe('idle');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('starts loading on the first render and resolves to ready, fetching once', async () => {
    const fetcher = vi.fn().mockResolvedValue({ n: 3 });
    const { result } = renderHook(() => useDashboardResource(fetcher, true));

    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data).toEqual({ n: 3 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reports the error message, or the fallback, and recovers on reload', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('Server said no'))
      .mockRejectedValueOnce('opaque')
      .mockResolvedValueOnce('ok');
    const { result } = renderHook(() => useDashboardResource(fetcher, true, 'Fallback'));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('Server said no');

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.error).toBe('Fallback'));

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data).toBe('ok');
    expect(result.current.error).toBeNull();
  });

  it('drops a stale response that resolves after a newer one', async () => {
    let resolveFirst: (v: string) => void = () => {};
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => new Promise<string>((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce('second');
    const { result } = renderHook(() => useDashboardResource(fetcher, true));

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toBe('second'));
    await act(async () => resolveFirst('first'));
    expect(result.current.data).toBe('second');
  });

  it('returns to idle when disabled after loading', async () => {
    const fetcher = vi.fn().mockResolvedValue(1);
    const { result, rerender } = renderHook(({ on }) => useDashboardResource(fetcher, on), {
      initialProps: { on: true },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    rerender({ on: false });
    expect(result.current.status).toBe('idle');
    expect(result.current.data).toBeNull();
  });
});
