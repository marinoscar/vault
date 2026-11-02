/**
 * Where the Home dashboard links to, in one place.
 *
 * The backup links point at their settings cards (E10.3, #94): the user's
 * My backups card and the Console's Backups card.
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
  /** The user's My backups card (`USER_SETTINGS_SECTIONS`). */
  myBackups: '/settings/backups',
  /** The Console's Backups card (`ADMIN_SECTIONS`): the scheduled system backups. */
  systemBackups: '/admin/settings/backups',
} as const;
