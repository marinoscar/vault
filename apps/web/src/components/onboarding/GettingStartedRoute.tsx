/**
 * Settings > Account > Getting started (`/settings/getting-started`, issue #91, E9.3).
 *
 * The platform's `GettingStartedPage`, refreshed when it mounts: the shell's provider reads once and does
 * not poll, and a user returning from "New secret" must see that step done. Ungated like every
 * `/settings/*` sibling that reads only the caller's own state: the route needs `user_settings:read`
 * (held by every role, a Viewer included).
 */

import { useEffect } from 'react';
import { useOnboarding } from '@marinoscar/platform-web/onboarding/headless';
import { GettingStartedPage } from '@marinoscar/platform-web/onboarding/ui';

export default function GettingStartedRoute() {
  const { refresh } = useOnboarding();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <GettingStartedPage />;
}
