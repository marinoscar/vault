/**
 * Settings > Your data > Download your data (`/settings/data-export`, issue #91, E9.3).
 *
 * The platform's `DataExportPage` with Vault's explanation in its `BeforeContent` slot: the downloads
 * describe the data and carry no secret value; the values leave only in the password-protected zip.
 */

import { DataExportPage } from '@marinoscar/platform-web/exports/ui';
import type { DataExportPageSlots } from '@marinoscar/platform-web/exports/ui';

import { VaultExportNotice } from '../components/exports/VaultExportNotice';

const SLOTS: DataExportPageSlots = { BeforeContent: VaultExportNotice };

export default function DataExportRoute() {
  return <DataExportPage slots={SLOTS} />;
}
