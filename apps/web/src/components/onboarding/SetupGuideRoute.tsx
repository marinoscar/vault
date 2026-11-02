/**
 * Console > Administration > Setup guide (`/admin/settings/setup`, issue #91, E9.3).
 *
 * The platform's `SetupGuidePage`, refreshed when it mounts (the shell's provider reads once). The route is
 * gated on `system_settings:read` in `App.tsx`, the string the platform adds the `admin` block of
 * `GET /api/onboarding` for and gates `GET /api/admin/onboarding/metrics` on.
 */

import { useEffect } from 'react';
import { useOnboarding } from '@marinoscar/platform-web/onboarding/headless';
import { SetupGuidePage } from '@marinoscar/platform-web/onboarding/ui';

export default function SetupGuideRoute() {
  const { refresh } = useOnboarding();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <SetupGuidePage />;
}
