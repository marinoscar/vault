import { useEffect, useMemo, useState } from 'react';
import { Box, Card, Container, Typography } from '@mui/material';
import { useAuth, usePermissions } from '@marinoscar/platform-web/identity/headless';
import { useCards } from '../hooks/useCards';
import { useAiStatus } from '../hooks/useAiStatus';
import { useDashboardResource } from '../hooks/useDashboardResource';
import type { DashboardResourceStatus } from '../hooks/useDashboardResource';
import {
  getBackupRuns,
  getBackupSchedule,
  getMediaFolders,
  getMyBackups,
  getSecrets,
} from '../services/api';
import { isNeedsAttention } from '../utils/cardExpiry';
import { WelcomeHeader } from '../components/home/WelcomeHeader';
import { QuickActions } from '../components/home/QuickActions';
import { StatsRow, type StatTile } from '../components/home/StatsRow';
import { ExpiringCardsPanel } from '../components/home/ExpiringCardsPanel';
import { RecentSecretsPanel, RECENT_SECRETS_LIMIT } from '../components/home/RecentSecretsPanel';
import { BackupStatusPanel, type SystemBackupStatus } from '../components/home/BackupStatusPanel';
import { FirstRunPanel } from '../components/home/FirstRunPanel';
import { HOME_LINKS } from '../components/home/homeLinks';

// Module-level fetchers: stable identities, one request each per mount.
const fetchRecentSecrets = () =>
  getSecrets({ page: 1, pageSize: RECENT_SECRETS_LIMIT, sortBy: 'updatedAt', sortOrder: 'desc' });
const fetchMyLatestBackup = () => getMyBackups({ page: 1, pageSize: 1 });
const fetchMediaCount = () => getMediaFolders({ page: 1, pageSize: 1 });
async function fetchSystemBackupStatus(): Promise<SystemBackupStatus> {
  const [runs, schedule] = await Promise.all([getBackupRuns({ page: 1, pageSize: 1 }), getBackupSchedule()]);
  return { latest: runs.items[0] ?? null, schedule };
}

/** "Scan a card" needs the AI status, so only a user who may write asks for it. */
function QuickActionsWithScan({ canBackUp }: { canBackUp: boolean }) {
  const { cardExtractEnabled, isLoading } = useAiStatus();
  return <QuickActions canCreateSecret canScanCard={!isLoading && cardExtractEnabled} canBackUp={canBackUp} />;
}

type LoadedStatus = Exclude<DashboardResourceStatus, 'idle'>;
const asLoaded = (status: DashboardResourceStatus): LoadedStatus => (status === 'idle' ? 'loading' : status);

/**
 * Home (E10.6, #97): urgency first. Cards that need attention, recently
 * updated secrets and backup health, each loading on its own, in parallel,
 * with its own skeleton, empty and error state, and each hidden when the user
 * lacks the permission its endpoint enforces.
 *
 * Requests per visit: `GET /secrets` (recent), one
 * `/secrets/cards/summary?page=1&pageSize=100` (#118: last four digits and
 * expiry decrypted server-side, soonest first; a second page only when more
 * than 100 cards need attention), `/backups/me`, `/media/folders`
 * (count), `/ai/status` (writers) and, for administrators,
 * `/admin/backups` with `/admin/backups/schedule`.
 */
export default function HomePage() {
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const canReadSecrets = hasPermission('secrets:read');
  const canWriteSecrets = hasPermission('secrets:write');
  const canReadMedia = hasPermission('media:read');
  const canReadSystemBackups = hasPermission('system_settings:read');

  // One instant for the whole page, so every relative time agrees.
  const now = useMemo(() => new Date(), []);

  const recent = useDashboardResource(fetchRecentSecrets, canReadSecrets, 'Could not load your recent secrets.');
  const myBackups = useDashboardResource(fetchMyLatestBackup, canReadSecrets, 'Could not load your backups.');
  const systemBackups = useDashboardResource(
    fetchSystemBackupStatus,
    canReadSystemBackups,
    'Could not load the system backups.',
  );
  const media = useDashboardResource(fetchMediaCount, canReadMedia, 'Could not load media.');

  const cardsState = useCards();
  const { fetchCards } = cardsState;
  const [cardsRequested, setCardsRequested] = useState(false);
  useEffect(() => {
    if (!canReadSecrets) return;
    setCardsRequested(true);
    void fetchCards({ now, scope: 'attention' });
  }, [canReadSecrets, fetchCards, now]);
  const cardsStatus: LoadedStatus =
    !cardsRequested || cardsState.isLoading ? 'loading' : cardsState.error ? 'error' : 'ready';
  const attentionCount = cardsState.cards.filter((card) => isNeedsAttention(card.status)).length;

  const isFirstRun = recent.status === 'ready' && (recent.data?.meta.totalItems ?? 0) === 0;

  const tiles: StatTile[] = [];
  if (canReadSecrets && !isFirstRun) {
    tiles.push(
      {
        key: 'secrets',
        label: 'Secrets',
        value: recent.data?.meta.totalItems ?? null,
        status: asLoaded(recent.status),
        to: HOME_LINKS.secrets,
      },
      { key: 'cards', label: 'Cards', value: cardsState.totalItems, status: cardsStatus, to: HOME_LINKS.cards },
      {
        key: 'attention',
        label: 'Need attention',
        value: attentionCount,
        status: cardsStatus,
        to: HOME_LINKS.cardsNeedingAttention,
        emphasize: true,
      },
    );
  }
  // First run: a strip of zeros is noise next to the one call to action.
  if (canReadMedia && !isFirstRun) {
    tiles.push({
      key: 'media',
      label: 'Media folders',
      value: media.data?.meta.totalItems ?? null,
      status: asLoaded(media.status),
      to: HOME_LINKS.media,
    });
  }

  const quickActions = canWriteSecrets ? (
    <QuickActionsWithScan canBackUp={canReadSecrets} />
  ) : (
    <QuickActions canCreateSecret={false} canScanCard={false} canBackUp={canReadSecrets} />
  );

  const showBackups = canReadSecrets || canReadSystemBackups;
  const hasAnything = canReadSecrets || canReadMedia || canReadSystemBackups;

  return (
    // The shell's <main> already pads the page; the container adds no gutter
    // of its own, so a phone never gets double padding.
    <Container maxWidth="lg" disableGutters>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 2, md: 3 }, pt: { xs: 0, sm: 1 } }}>
        <WelcomeHeader displayName={user?.displayName ?? null} actions={quickActions} now={now} />

        <StatsRow tiles={tiles} />

        {!hasAnything && (
          <Card variant="outlined" sx={{ p: 3 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Nothing to show yet. Ask an administrator for access to secrets or media.
            </Typography>
          </Card>
        )}

        {(canReadSecrets || showBackups) && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: { xs: 'column', md: 'row' },
              alignItems: { md: 'flex-start' },
              gap: { xs: 2, md: 3 },
            }}
          >
            {/* Phone: the columns dissolve (display: contents) so the panels
                order by urgency: cards, recent, backups. */}
            {canReadSecrets && (
              <Box
                sx={{
                  display: { xs: 'contents', md: 'flex' },
                  flexDirection: 'column',
                  gap: 3,
                  flex: { md: '7 1 0' },
                  minWidth: 0,
                }}
              >
                {isFirstRun ? (
                  <FirstRunPanel canCreate={canWriteSecrets} />
                ) : (
                  <RecentSecretsPanel
                    status={asLoaded(recent.status)}
                    secrets={recent.data?.items ?? []}
                    error={recent.error}
                    onRetry={recent.reload}
                    canCreate={canWriteSecrets}
                    phoneOrder={2}
                    now={now}
                  />
                )}
              </Box>
            )}
            <Box
              sx={{
                display: { xs: 'contents', md: 'flex' },
                flexDirection: 'column',
                gap: 3,
                flex: { md: canReadSecrets ? '5 1 0' : '1 1 0' },
                minWidth: 0,
              }}
            >
              {canReadSecrets && !isFirstRun && (
                <ExpiringCardsPanel
                  status={cardsStatus}
                  cards={cardsState.cards}
                  totalCards={cardsState.totalItems}
                  error={cardsState.error}
                  onRetry={() => void fetchCards({ now, scope: 'attention' })}
                  canRenew={canWriteSecrets}
                  phoneOrder={1}
                />
              )}
              {showBackups && (
                <BackupStatusPanel
                  mine={canReadSecrets ? myBackups : null}
                  system={canReadSystemBackups ? systemBackups : null}
                  phoneOrder={3}
                  now={now}
                />
              )}
            </Box>
          </Box>
        )}
      </Box>
    </Container>
  );
}
