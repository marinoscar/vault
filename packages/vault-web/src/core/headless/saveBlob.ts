/**
 * Trigger a browser download of an in-memory Blob under `filename`.
 * The object URL is revoked on the next tick, after the click has been
 * dispatched, so the blob can be garbage collected.
 */
export function saveBlobAsFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
