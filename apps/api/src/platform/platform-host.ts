// =============================================================================
// The platform host: how packaged controllers authenticate (issue #76)
// =============================================================================
//
// Every packaged slice takes its route decorators from the app instead of
// shipping its own, so a packaged route is never public by accident.
//
// PLATFORM-ADOPTION-SHIM(E3.2): until the identity slice lands, the answer is
// Vault's own `@Auth` and `@Public` (`src/auth/decorators`), which is what every
// existing route uses, so a packaged route (`/api/health`, `/api/admin/maintenance`,
// `/api/admin/doctor`, `/api/admin/about`) is guarded exactly like a Vault one.
// E3.2 rebinds this to the identity slice's decorators.
// =============================================================================

import { definePlatformHost } from '@marinoscar/platform-api/core';

import { Auth } from '../auth/decorators/auth.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { PermissionName } from '../common/constants/roles.constants';

export const platformHost = definePlatformHost({
  access: {
    requirePermissions: (permissions) =>
      Auth({ permissions: [...permissions] as PermissionName[] }) as MethodDecorator & ClassDecorator,
    requireAuthenticated: () => Auth() as MethodDecorator & ClassDecorator,
    allowPublic: () => Public() as MethodDecorator & ClassDecorator,
  },
});
