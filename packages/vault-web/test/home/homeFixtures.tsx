import { useLocation } from 'react-router-dom';
import type { CardSummary } from '../../src/cards/headless/useCards.js';
import type { BackupRun, BackupSchedule, SecretListItem, SecretType } from '../../src/core/headless/types.js';

/** The instant every Home test formats against (local time). */
export const NOW = new Date(2026, 10, 2, 10, 0, 0);
export const HOUR = 3600e3;
export const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
export const ahead = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

/** Renders the router's current location, so a test can follow a link. */
export function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

export const loginType: SecretType = {
  id: 'type-login',
  name: 'Login',
  description: null,
  icon: 'VpnKey',
  fields: [],
  allowAttachments: true,
  isSystem: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

export const cardType: SecretType = { ...loginType, id: 'type-card', name: 'Card', icon: 'CreditCard' };

export function makeSecret(id: string, name: string, updatedMsAgo = HOUR): SecretListItem {
  return {
    id,
    name,
    description: null,
    type: loginType,
    currentVersion: 1,
    createdAt: ago(1000 * HOUR),
    updatedAt: ago(updatedMsAgo),
  };
}

export function makeCardSummary(overrides: Partial<CardSummary> & { id: string }): CardSummary {
  return {
    name: overrides.id,
    last4: '4242',
    maskedNumber: '•••• 4242',
    expiryLabel: '12/26',
    status: 'expiring_soon',
    expirySortKey: 0,
    network: 'Visa',
    kind: 'Credit',
    issuingBank: 'Org Alpha',
    cardholderName: 'Person A',
    hasPhotos: false,
    updatedAt: ago(HOUR),
    ...overrides,
  };
}

export function makeRun(overrides: Partial<BackupRun> = {}): BackupRun {
  return {
    id: 'run-1',
    status: 'succeeded',
    trigger: 'manual',
    triggeredBy: null,
    sizeBytes: 1843200,
    userCount: 1,
    secretCount: 42,
    attachmentCount: 0,
    mediaFileCount: 0,
    contents: ['secrets'],
    warningCount: 0,
    error: null,
    startedAt: ago(3 * HOUR),
    finishedAt: ago(3 * HOUR),
    deletedAt: null,
    downloadable: true,
    ...overrides,
  };
}

export function makeSchedule(overrides: Partial<BackupSchedule> = {}): BackupSchedule {
  return {
    enabled: true,
    frequency: 'daily',
    intervalHours: null,
    timeOfDay: '03:00',
    dayOfWeek: null,
    dayOfMonth: null,
    timezone: 'UTC',
    keepCount: 7,
    includeSecrets: true,
    includeAttachments: false,
    includeVersions: false,
    includeMedia: false,
    includeSystem: false,
    passwordConfigured: true,
    passwordUpdatedAt: null,
    nextRunAt: ahead(9 * HOUR),
    lastRunAt: ago(15 * HOUR),
    storageConfigured: true,
    updatedAt: null,
    ...overrides,
  };
}
