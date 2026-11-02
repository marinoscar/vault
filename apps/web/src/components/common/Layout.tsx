import { ShellAppBar, ShellBottomNav, ShellLayout, ShellUserMenu } from '@marinoscar/platform-web/shell/ui';
import { NotificationProvider } from '@marinoscar/platform-web/notifications/headless';
import { NotificationBell } from '@marinoscar/platform-web/notifications/ui';
import { Suspense } from 'react';
import type { ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { BOTTOM_BAR_NAVIGATION, VAULT_NAVIGATION } from '../../config/shell';
import { BrandLockup } from '../brand/BrandLockup';
import { ErrorBoundary } from './ErrorBoundary';
import { LoadingSpinner } from './LoadingSpinner';

const BRAND = <BrandLockup />;
const BELL = <NotificationBell />;

/**
 * The signed-in shell: a thin binding of the platform's `ShellLayout`
 * (E10.2, issue #93). The app bar with the Vault lockup, theme toggle and user
 * menu; the rail at 600px and up (Console mode under `/admin`); the bottom bar
 * below 600px with the four non-pinned destinations.
 *
 * The notification centre (E7.2) is the platform's: `NotificationProvider`
 * wraps the shell (this layout only renders for a signed-in viewer, behind
 * `ProtectedRoute`) and the `NotificationBell` sits in the app bar's `actions`
 * slot, at every width. The bell's popover is the inbox; the slice is
 * configured once in `platform/notifications.ts`.
 *
 * The FIVE COUPLED BREAKPOINT GATES are the platform's (`ShellLayout` showRail
 * and `<main>` padding, `ShellBottomNav`, `ShellAppBar`, `SettingsHub`). This
 * file reads no breakpoint, and none may be added
 * (`__tests__/config/breakpointGates.test.ts`).
 */
export function Layout({ children }: { children?: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <NotificationProvider>
      <ShellLayout
        navigation={VAULT_NAVIGATION}
        appBar={
          <ShellAppBar
            navigation={VAULT_NAVIGATION}
            brand={BRAND}
            actions={BELL}
            userMenu={<ShellUserMenu navigation={VAULT_NAVIGATION} logoutLabel="Sign out" />}
          />
        }
        bottomNav={<ShellBottomNav navigation={BOTTOM_BAR_NAVIGATION} />}
      >
        {/* Pages are lazy: the shell stays mounted while one loads, and a page
            that throws keeps the navigation (the boundary resets on navigation). */}
        <ErrorBoundary key={pathname}>
          <Suspense fallback={<LoadingSpinner />}>{children ?? <Outlet />}</Suspense>
        </ErrorBoundary>
      </ShellLayout>
    </NotificationProvider>
  );
}
