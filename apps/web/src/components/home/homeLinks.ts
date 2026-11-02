/**
 * Where the Home dashboard links to, in one place.
 *
 * The settings destinations are the pages that exist today; E10.3 moves them
 * into hub cards (`/settings/backups`, `/admin/settings/backups`) and only
 * these constants change.
 */
export const HOME_LINKS = {
  secrets: '/secrets',
  newSecret: '/secrets/new',
  secretDetail: (id: string) => `/secrets/${encodeURIComponent(id)}`,
  cards: '/cards',
  /**
   * The Cards gallery filtered to cards that need attention (expired or
   * expiring within 60 days). The gallery reads `?filter=attention` (E10.5).
   */
  cardsNeedingAttention: '/cards?filter=attention',
  scanCard: '/cards/import',
  renewCard: (id: string) => `/cards/${encodeURIComponent(id)}/renew`,
  media: '/media',
  /** "Back up my data" (saved backups) on the user's settings page. */
  myBackups: '/settings',
  /** The scheduled (system) backups on the admin settings page. */
  systemBackups: '/admin/settings',
} as const;
