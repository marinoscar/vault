import { useState, useCallback, useEffect, useRef } from 'react';
import { copyToClipboard, type CopyToClipboardOptions } from '../utils/clipboard';

/** How long the `copied` acknowledgement stays true, in milliseconds. */
export const COPIED_RESET_MS = 1500;

interface UseCopyToClipboardResult {
  /** Copy `text`; resolves to true on success. Never throws. */
  copy: (text: string) => Promise<boolean>;
  /** True for a short window after a successful copy. */
  copied: boolean;
  /** True for a short window after a failed copy. */
  failed: boolean;
}

/**
 * Clipboard copying with the transient acknowledgement state a button needs.
 *
 * `copied` and `failed` are mutually exclusive and both reset after
 * {@link COPIED_RESET_MS}. Pending timers are cancelled on unmount so a copy
 * from a row that then disappears cannot set state on an unmounted component.
 */
export function useCopyToClipboard(
  options: CopyToClipboardOptions = {},
): UseCopyToClipboardResult {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // Held in a ref so callers can pass an inline options object without
  // invalidating `copy` on every render.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };
  }, []);

  const copy = useCallback(async (text: string): Promise<boolean> => {
    const success = await copyToClipboard(text, optionsRef.current);

    if (!isMountedRef.current) {
      return success;
    }

    setCopied(success);
    setFailed(!success);

    // Restart the window on every copy so rapid clicks don't clear early.
    if (resetTimerRef.current !== null) {
      clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = setTimeout(() => {
      resetTimerRef.current = null;
      if (isMountedRef.current) {
        setCopied(false);
        setFailed(false);
      }
    }, COPIED_RESET_MS);

    return success;
  }, []);

  return { copy, copied, failed };
}
