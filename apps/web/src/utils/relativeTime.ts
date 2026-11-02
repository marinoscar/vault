/**
 * Compact relative time ("5m ago", "in 3h") for dashboard rows.
 *
 * `now` is injectable so a whole panel formats against one instant and tests
 * stay deterministic. Invalid input yields an empty string, never "NaN ago".
 */
export function formatRelativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const date = new Date(iso);
  const diffMs = now.getTime() - date.getTime();
  if (Number.isNaN(diffMs)) return '';

  const future = diffMs < 0;
  const minutes = Math.floor(Math.abs(diffMs) / 60000);
  const wrap = (value: string) => (future ? `in ${value}` : `${value} ago`);

  if (minutes < 1) return future ? 'in under a minute' : 'just now';
  if (minutes < 60) return wrap(`${minutes}m`);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return wrap(`${hours}h`);
  const days = Math.floor(hours / 24);
  if (days < 30) return wrap(`${days}d`);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
