/**
 * Clipboard helpers for copying secret values to the system clipboard.
 *
 * Two properties matter here beyond a plain `writeText` call:
 *
 * 1. Failure is reported, not thrown. Clipboard access is denied in insecure
 *    contexts, when the document is not focused, and by permission policy, so
 *    callers need to render a fallback rather than crash.
 * 2. Copied secrets do not linger. After a timeout we clear the clipboard, but
 *    only when a readback confirms it still holds exactly what we wrote. If the
 *    user copied something else in the meantime, or readback is unavailable, we
 *    leave the clipboard untouched.
 */

/** Default delay before an auto-clear is attempted, in milliseconds. */
export const DEFAULT_CLIPBOARD_CLEAR_MS = 45_000;

export interface CopyToClipboardOptions {
  /**
   * Milliseconds to wait before attempting to clear the clipboard.
   * Defaults to {@link DEFAULT_CLIPBOARD_CLEAR_MS}.
   */
  clearAfterMs?: number;
  /** Set to false to copy without scheduling an auto-clear. Defaults to true. */
  autoClear?: boolean;
}

/**
 * True when the Clipboard API can be used to write. Returns false in insecure
 * contexts and on older browsers, where `navigator.clipboard` is undefined.
 */
export function isClipboardAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.writeText === 'function'
  );
}

/**
 * True when the clipboard can be read back. Readback is more restricted than
 * writing: Firefox does not expose `readText` to page script at all, and
 * Chromium gates it behind the `clipboard-read` permission.
 */
export function isClipboardReadable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.readText === 'function'
  );
}

/**
 * Clear the clipboard, but only if it still holds `expected`.
 *
 * Readback is required: without it we cannot tell our own value apart from
 * whatever the user copied since, and wiping the latter would destroy data the
 * app never owned. So when `readText` is missing or rejects (permission
 * denied), this is a no-op.
 *
 * @returns true only when the clipboard was actually cleared.
 */
export async function clearClipboardIfUnchanged(expected: string): Promise<boolean> {
  if (!isClipboardAvailable() || !isClipboardReadable()) {
    return false;
  }

  let current: string;
  try {
    current = await navigator.clipboard.readText();
  } catch {
    // Readback denied or unavailable. Never clear blind.
    return false;
  }

  if (current !== expected) {
    // The user copied something else. Leave it alone.
    return false;
  }

  try {
    await navigator.clipboard.writeText('');
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy `text` to the clipboard, scheduling an auto-clear by default.
 *
 * Never throws: a missing Clipboard API or a rejected write both resolve to
 * false so the caller can surface a fallback.
 *
 * @returns true when the write succeeded.
 */
export async function copyToClipboard(
  text: string,
  options: CopyToClipboardOptions = {},
): Promise<boolean> {
  const { clearAfterMs = DEFAULT_CLIPBOARD_CLEAR_MS, autoClear = true } = options;

  if (!isClipboardAvailable()) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return false;
  }

  // Never schedule a clear for an empty copy — there is nothing to scrub, and
  // an empty `expected` would match a clipboard we already cleared.
  if (autoClear && text !== '' && clearAfterMs > 0) {
    scheduleClipboardClear(text, clearAfterMs);
  }

  return true;
}

/**
 * Schedule a best-effort clipboard clear. Returns the timer handle so callers
 * that own a lifecycle (React components) can cancel it.
 */
export function scheduleClipboardClear(
  expected: string,
  delayMs: number = DEFAULT_CLIPBOARD_CLEAR_MS,
): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    void clearClipboardIfUnchanged(expected);
  }, delayMs);
}
