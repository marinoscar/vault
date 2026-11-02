import { Link } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';

/**
 * The Console's Storage card (E6.1 web follow-up): the packaged
 * `StorageConfigPage`, where an administrator sets the bucket and its key.
 * Since E6.1 (#84) object storage is runtime configuration, never environment
 * variables, so every "storage is not configured" hint points here.
 */
export const STORAGE_SETTINGS_PATH = '/admin/settings/storage';

/** The exact string the platform's storage-config controller enforces on its GET. */
export const STORAGE_SETTINGS_PERMISSION = 'storage_config:read';

export const STORAGE_SETTINGS_LINK_LABEL = 'Set up storage in Console → Storage';

/**
 * A link to the Storage card, rendered only for a viewer who can open it
 * (`storage_config:read`); for anyone else it renders nothing, so the hint
 * around it reads as "ask an administrator". Hiding it is presentation only:
 * the route and the API enforce the permission.
 */
export function StorageSettingsLink({ label = STORAGE_SETTINGS_LINK_LABEL }: { label?: string }) {
  const { hasPermission } = usePermissions();
  if (!hasPermission(STORAGE_SETTINGS_PERMISSION)) return null;
  return (
    <Link component={RouterLink} to={STORAGE_SETTINGS_PATH} data-testid="storage-settings-link">
      {label}
    </Link>
  );
}
