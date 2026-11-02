/**
 * Vault's bindings of the platform user-data pages (issue #91, E9.3): the per-user Danger Zone
 * (`/settings/danger-zone`) and the admin factory reset (`/admin/settings/factory-reset`).
 *
 * The packaged pages own everything that matters: the live counts, the typed confirmation, the progress and
 * the result. The lists of what is deleted and kept come from the API (`GET /api/user-data/summary`,
 * `GET /api/admin/factory-reset/summary`), including the lines Vault registered. This file adds only the
 * notice above each page and refreshes the viewer when a deletion finishes (the platform does it too, so
 * `onCompleted` is the app's own cache hook: Vault keeps none).
 */

import { FactoryResetPage, UserDangerZonePage } from '@marinoscar/platform-web/user-data/ui';
import type { FactoryResetPageSlots, UserDangerZonePageSlots } from '@marinoscar/platform-web/user-data/ui';

import { FactoryResetNotice, UserDangerZoneNotice } from '../components/user-data/DangerZoneNotices';

const DANGER_ZONE_SLOTS: UserDangerZonePageSlots = { BeforeContent: UserDangerZoneNotice };
const FACTORY_RESET_SLOTS: FactoryResetPageSlots = { BeforeContent: FactoryResetNotice };

export function DangerZoneRoute() {
  return <UserDangerZonePage slots={DANGER_ZONE_SLOTS} />;
}

export function FactoryResetRoute() {
  return <FactoryResetPage slots={FACTORY_RESET_SLOTS} />;
}
