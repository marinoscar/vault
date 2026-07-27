import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  copyToClipboard,
  clearClipboardIfUnchanged,
  isClipboardAvailable,
  isClipboardReadable,
  DEFAULT_CLIPBOARD_CLEAR_MS,
} from '../../utils/clipboard';
import { clipboardMock, resetClipboardMock } from '../setup';

const SECRET = '4242424242424242';

/** Replace navigator.clipboard for a single test; undone by resetClipboardMock. */
function stubClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    writable: true,
    value,
  });
}

describe('clipboard', () => {
  beforeEach(() => {
    resetClipboardMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetClipboardMock();
  });

  describe('isClipboardAvailable', () => {
    it('should be true when navigator.clipboard exposes writeText', () => {
      expect(isClipboardAvailable()).toBe(true);
    });

    it('should be false when the Clipboard API is missing entirely', () => {
      stubClipboard(undefined);
      expect(isClipboardAvailable()).toBe(false);
    });

    it('should be false when writeText is not a function', () => {
      stubClipboard({ writeText: 'nope' });
      expect(isClipboardAvailable()).toBe(false);
    });
  });

  describe('isClipboardReadable', () => {
    it('should be true when readText is exposed', () => {
      expect(isClipboardReadable()).toBe(true);
    });

    it('should be false when readText is absent (e.g. Firefox)', () => {
      stubClipboard({ writeText: vi.fn() });
      expect(isClipboardReadable()).toBe(false);
    });
  });

  describe('copyToClipboard - success path', () => {
    it('should return true when the write succeeds', async () => {
      await expect(copyToClipboard(SECRET, { autoClear: false })).resolves.toBe(true);
    });

    it('should pass the exact text through to writeText', async () => {
      await copyToClipboard(SECRET, { autoClear: false });
      expect(clipboardMock.writeText).toHaveBeenCalledWith(SECRET);
    });

    it('should write exactly once per call', async () => {
      await copyToClipboard(SECRET, { autoClear: false });
      expect(clipboardMock.writeText).toHaveBeenCalledTimes(1);
    });
  });

  describe('copyToClipboard - failure paths', () => {
    it('should return false rather than throw when writeText rejects', async () => {
      clipboardMock.writeText.mockRejectedValue(new Error('Write permission denied'));
      await expect(copyToClipboard(SECRET)).resolves.toBe(false);
    });

    it('should return false when the Clipboard API is missing (insecure context)', async () => {
      stubClipboard(undefined);
      await expect(copyToClipboard(SECRET)).resolves.toBe(false);
    });

    it('should not attempt a write when the Clipboard API is missing', async () => {
      stubClipboard(undefined);
      await copyToClipboard(SECRET);
      expect(clipboardMock.writeText).not.toHaveBeenCalled();
    });

    it('should not schedule an auto-clear when the write failed', async () => {
      vi.useFakeTimers();
      clipboardMock.writeText.mockRejectedValue(new Error('denied'));

      await copyToClipboard(SECRET);
      clipboardMock.writeText.mockResolvedValue(undefined);
      await vi.advanceTimersByTimeAsync(DEFAULT_CLIPBOARD_CLEAR_MS * 2);

      expect(clipboardMock.writeText).not.toHaveBeenCalledWith('');
    });
  });

  describe('copyToClipboard - auto-clear', () => {
    it('should clear the clipboard after the default timeout when it still holds our value', async () => {
      vi.useFakeTimers();
      clipboardMock.readText.mockResolvedValue(SECRET);

      await copyToClipboard(SECRET);
      expect(clipboardMock.writeText).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(DEFAULT_CLIPBOARD_CLEAR_MS);

      expect(clipboardMock.writeText).toHaveBeenCalledTimes(2);
      expect(clipboardMock.writeText).toHaveBeenLastCalledWith('');
    });

    it('should honour a custom clear timeout', async () => {
      vi.useFakeTimers();
      clipboardMock.readText.mockResolvedValue(SECRET);

      await copyToClipboard(SECRET, { clearAfterMs: 1000 });
      await vi.advanceTimersByTimeAsync(1000);

      expect(clipboardMock.writeText).toHaveBeenLastCalledWith('');
    });

    it('should not clear before the timeout elapses', async () => {
      vi.useFakeTimers();
      clipboardMock.readText.mockResolvedValue(SECRET);

      await copyToClipboard(SECRET);
      await vi.advanceTimersByTimeAsync(DEFAULT_CLIPBOARD_CLEAR_MS - 1);

      expect(clipboardMock.writeText).not.toHaveBeenCalledWith('');
    });

    it('should NOT clear when the clipboard changed underneath us', async () => {
      vi.useFakeTimers();
      // The user copied something else after we wrote the secret.
      clipboardMock.readText.mockResolvedValue('something the user copied');

      await copyToClipboard(SECRET);
      await vi.advanceTimersByTimeAsync(DEFAULT_CLIPBOARD_CLEAR_MS);

      expect(clipboardMock.writeText).toHaveBeenCalledTimes(1);
      expect(clipboardMock.writeText).not.toHaveBeenCalledWith('');
    });

    it('should NOT clear when readback is denied by permission policy', async () => {
      vi.useFakeTimers();
      clipboardMock.readText.mockRejectedValue(new Error('Read permission denied'));

      await copyToClipboard(SECRET);
      await vi.advanceTimersByTimeAsync(DEFAULT_CLIPBOARD_CLEAR_MS);

      expect(clipboardMock.writeText).not.toHaveBeenCalledWith('');
    });

    it('should NOT clear when readText is unavailable', async () => {
      vi.useFakeTimers();
      const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
      stubClipboard({ writeText });

      await copyToClipboard(SECRET);
      await vi.advanceTimersByTimeAsync(DEFAULT_CLIPBOARD_CLEAR_MS);

      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText).not.toHaveBeenCalledWith('');
    });

    it('should not schedule a clear when autoClear is disabled', async () => {
      vi.useFakeTimers();
      clipboardMock.readText.mockResolvedValue(SECRET);

      await copyToClipboard(SECRET, { autoClear: false });
      await vi.advanceTimersByTimeAsync(DEFAULT_CLIPBOARD_CLEAR_MS * 2);

      expect(clipboardMock.writeText).toHaveBeenCalledTimes(1);
    });

    it('should not schedule a clear for an empty copy', async () => {
      vi.useFakeTimers();
      clipboardMock.readText.mockResolvedValue('');

      await copyToClipboard('');
      await vi.advanceTimersByTimeAsync(DEFAULT_CLIPBOARD_CLEAR_MS * 2);

      expect(clipboardMock.writeText).toHaveBeenCalledTimes(1);
    });

    it('should swallow a rejection from the clearing write', async () => {
      vi.useFakeTimers();
      clipboardMock.readText.mockResolvedValue(SECRET);
      clipboardMock.writeText
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('denied on clear'));

      await copyToClipboard(SECRET);

      await expect(
        vi.advanceTimersByTimeAsync(DEFAULT_CLIPBOARD_CLEAR_MS),
      ).resolves.not.toThrow();
    });
  });

  describe('clearClipboardIfUnchanged', () => {
    it('should clear and report true when the clipboard still holds the value', async () => {
      clipboardMock.readText.mockResolvedValue(SECRET);

      await expect(clearClipboardIfUnchanged(SECRET)).resolves.toBe(true);
      expect(clipboardMock.writeText).toHaveBeenCalledWith('');
    });

    it('should report false and leave the clipboard alone when it changed', async () => {
      clipboardMock.readText.mockResolvedValue('unrelated');

      await expect(clearClipboardIfUnchanged(SECRET)).resolves.toBe(false);
      expect(clipboardMock.writeText).not.toHaveBeenCalled();
    });

    it('should report false when readback is denied', async () => {
      clipboardMock.readText.mockRejectedValue(new Error('denied'));

      await expect(clearClipboardIfUnchanged(SECRET)).resolves.toBe(false);
      expect(clipboardMock.writeText).not.toHaveBeenCalled();
    });

    it('should report false when the Clipboard API is missing', async () => {
      stubClipboard(undefined);
      await expect(clearClipboardIfUnchanged(SECRET)).resolves.toBe(false);
    });

    it('should report false when the clearing write itself fails', async () => {
      clipboardMock.readText.mockResolvedValue(SECRET);
      clipboardMock.writeText.mockRejectedValue(new Error('denied'));

      await expect(clearClipboardIfUnchanged(SECRET)).resolves.toBe(false);
    });
  });
});
