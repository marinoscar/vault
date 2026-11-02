import { Alert, Box, Paper, Snackbar, Typography } from '@mui/material';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import { useSystemSettings } from '../../hooks/useSystemSettings';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { SettingsPageFrame } from '../../components/settings/SettingsPageFrame';
import { FeatureFlagsList } from '../../components/admin/FeatureFlagsList';
import { UISettings } from '../../components/admin/UISettings';

/**
 * The `General` card of the Console (`/admin/settings/general`, E10.3 #94):
 * what were the "UI Settings" and "Feature Flags" tabs of the old
 * `SystemSettingsPage`, unchanged, stacked on one page. Read needs
 * `system_settings:read` (the route gates on it too); every control is
 * disabled without `system_settings:write`. The "Advanced (JSON)" tab is gone
 * (spec §6); `PUT /api/system-settings` stays in the API.
 */
export default function GeneralSettingsPage() {
  const { hasPermission } = usePermissions();
  const { settings, isLoading, error, isSaving, updateSettings } = useSystemSettings();

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  if (!hasPermission('system_settings:read')) {
    return <Navigate to="/" replace />;
  }

  const canWrite = hasPermission('system_settings:write');

  const handleSave = async (key: string, value: unknown) => {
    try {
      await updateSettings({ [key]: value });
      setSuccessMessage('Settings saved');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <SettingsPageFrame
      title="General"
      description={`Interface options and feature flags for everyone${canWrite ? '' : ' (read-only)'}`}
    >
      {settings?.updatedBy && (
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
          Last updated by {settings.updatedBy.email} on {new Date(settings.updatedAt).toLocaleString()}
        </Typography>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {settings && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Paper sx={{ p: { xs: 2, sm: 3 } }}>
            <UISettings
              settings={settings.ui}
              onSave={(ui) => handleSave('ui', ui)}
              disabled={!canWrite || isSaving}
            />
          </Paper>
          <Paper sx={{ p: { xs: 2, sm: 3 } }}>
            <FeatureFlagsList
              flags={settings.features}
              onSave={(features) => handleSave('features', features)}
              disabled={!canWrite || isSaving}
            />
          </Paper>
        </Box>
      )}

      <Snackbar
        open={!!successMessage}
        autoHideDuration={3000}
        onClose={() => setSuccessMessage(null)}
        message={successMessage}
      />
      <Snackbar open={!!localError} autoHideDuration={5000} onClose={() => setLocalError(null)}>
        <Alert severity="error" onClose={() => setLocalError(null)}>
          {localError}
        </Alert>
      </Snackbar>
    </SettingsPageFrame>
  );
}
