import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCopyToClipboard, COPIED_RESET_MS } from '../../hooks/useCopyToClipboard';
import { clipboardMock, resetClipboardMock } from '../setup';

const SECRET = 'super-secret-value';

describe('useCopyToClipboard', () => {
  beforeEach(() => {
    resetClipboardMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetClipboardMock();
  });

  describe('Initial state', () => {
    it('should start with copied and failed both false', () => {
      const { result } = renderHook(() => useCopyToClipboard());

      expect(result.current.copied).toBe(false);
      expect(result.current.failed).toBe(false);
    });

    it('should expose a copy function', () => {
      const { result } = renderHook(() => useCopyToClipboard());
      expect(typeof result.current.copy).toBe('function');
    });
  });

  describe('Successful copy', () => {
    it('should set copied to true', async () => {
      const { result } = renderHook(() => useCopyToClipboard({ autoClear: false }));

      await act(async () => {
        await result.current.copy(SECRET);
      });

      expect(result.current.copied).toBe(true);
      expect(result.current.failed).toBe(false);
    });

    it('should resolve to true', async () => {
      const { result } = renderHook(() => useCopyToClipboard({ autoClear: false }));

      let returned: boolean | undefined;
      await act(async () => {
        returned = await result.current.copy(SECRET);
      });

      expect(returned).toBe(true);
    });

    it('should write the given text to the clipboard', async () => {
      const { result } = renderHook(() => useCopyToClipboard({ autoClear: false }));

      await act(async () => {
        await result.current.copy(SECRET);
      });

      expect(clipboardMock.writeText).toHaveBeenCalledWith(SECRET);
    });

    it(`should reset copied after ${COPIED_RESET_MS}ms`, async () => {
      const { result } = renderHook(() => useCopyToClipboard({ autoClear: false }));

      await act(async () => {
        await result.current.copy(SECRET);
      });
      expect(result.current.copied).toBe(true);

      await waitFor(
        () => {
          expect(result.current.copied).toBe(false);
        },
        { timeout: COPIED_RESET_MS + 1000 },
      );
    });
  });

  describe('Failed copy', () => {
    it('should set failed to true when the write is rejected', async () => {
      clipboardMock.writeText.mockRejectedValue(new Error('Permission denied'));
      const { result } = renderHook(() => useCopyToClipboard());

      await act(async () => {
        await result.current.copy(SECRET);
      });

      expect(result.current.failed).toBe(true);
      expect(result.current.copied).toBe(false);
    });

    it('should resolve to false rather than throwing', async () => {
      clipboardMock.writeText.mockRejectedValue(new Error('Permission denied'));
      const { result } = renderHook(() => useCopyToClipboard());

      let returned: boolean | undefined;
      await act(async () => {
        returned = await result.current.copy(SECRET);
      });

      expect(returned).toBe(false);
    });

    it('should set failed when the Clipboard API is unavailable', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        writable: true,
        value: undefined,
      });

      const { result } = renderHook(() => useCopyToClipboard());

      await act(async () => {
        await result.current.copy(SECRET);
      });

      expect(result.current.failed).toBe(true);
    });

    it('should reset failed after the acknowledgement window', async () => {
      clipboardMock.writeText.mockRejectedValue(new Error('Permission denied'));
      const { result } = renderHook(() => useCopyToClipboard());

      await act(async () => {
        await result.current.copy(SECRET);
      });
      expect(result.current.failed).toBe(true);

      await waitFor(
        () => {
          expect(result.current.failed).toBe(false);
        },
        { timeout: COPIED_RESET_MS + 1000 },
      );
    });
  });

  describe('State transitions', () => {
    it('should clear a previous failure on a subsequent successful copy', async () => {
      clipboardMock.writeText.mockRejectedValueOnce(new Error('denied'));
      const { result } = renderHook(() => useCopyToClipboard({ autoClear: false }));

      await act(async () => {
        await result.current.copy(SECRET);
      });
      expect(result.current.failed).toBe(true);

      await act(async () => {
        await result.current.copy(SECRET);
      });

      expect(result.current.copied).toBe(true);
      expect(result.current.failed).toBe(false);
    });

    it('should keep copied true across rapid repeat copies', async () => {
      const { result } = renderHook(() => useCopyToClipboard({ autoClear: false }));

      await act(async () => {
        await result.current.copy(SECRET);
        await result.current.copy(SECRET);
      });

      expect(result.current.copied).toBe(true);
    });
  });

  describe('Cleanup', () => {
    it('should clear the pending reset timer on unmount', async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
      const { result, unmount } = renderHook(() => useCopyToClipboard({ autoClear: false }));

      await act(async () => {
        await result.current.copy(SECRET);
      });

      unmount();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('should not warn about setting state after unmount', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { result, unmount } = renderHook(() => useCopyToClipboard({ autoClear: false }));

      const pending = result.current.copy(SECRET);
      unmount();
      await act(async () => {
        await pending;
      });

      expect(errorSpy).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('Auto-clear integration', () => {
    it('should schedule a clipboard clear that fires after the configured delay', async () => {
      vi.useFakeTimers();
      clipboardMock.readText.mockResolvedValue(SECRET);

      const { result } = renderHook(() => useCopyToClipboard({ clearAfterMs: 5000 }));

      await act(async () => {
        await result.current.copy(SECRET);
      });

      expect(clipboardMock.writeText).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(clipboardMock.writeText).toHaveBeenLastCalledWith('');
    });

    it('should not clear a clipboard the user has since overwritten', async () => {
      vi.useFakeTimers();
      clipboardMock.readText.mockResolvedValue('user copied this instead');

      const { result } = renderHook(() => useCopyToClipboard({ clearAfterMs: 5000 }));

      await act(async () => {
        await result.current.copy(SECRET);
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(clipboardMock.writeText).not.toHaveBeenCalledWith('');
    });
  });
});
