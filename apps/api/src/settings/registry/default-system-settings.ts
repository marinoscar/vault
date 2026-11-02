// The composed default system settings, for specs, fixtures and the seed:
// every registered namespace's `defaults`, in registration order. Production code
// reads a namespace through `SystemSettingsService.getNamespace(key)`.

import { composeDefaultSystemSettings, type SystemSettingsValue } from '@marinoscar/platform-api/settings';

import './index';

export const DEFAULT_SYSTEM_SETTINGS: SystemSettingsValue = structuredClone(composeDefaultSystemSettings());
