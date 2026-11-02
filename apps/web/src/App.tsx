import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { ShellPreferencesProvider } from '@marinoscar/platform-web/shell/headless';
import { ShellRoot } from '@marinoscar/platform-web/shell/ui';
// Identity is the platform's (E3.3, #78): the session provider, the route
// guards and the identity pages come from @marinoscar/platform-web/identity.
import { RequireAuth, RequirePermission } from '@marinoscar/platform-web/identity/headless';
// Telemetry (E9.2, #90): the platform's config provider and route guard, and the adapters the pages take.
import {
  RequireTelemetryEnabled,
  TelemetryWebAdaptersProvider,
} from '@marinoscar/platform-web/telemetry/headless';
import { IdentityProviders } from './identity/IdentityProviders';
import { VaultPlatformHostProvider } from './platform/platformHost';
// The platform AI slice (E8.2, #88): the AI config every `feature: 'ai'` card and
// `RequireAiEnabled` read, and the adapters (Vault's spinner) the AI pages take.
import { AiWebAdaptersProvider } from '@marinoscar/platform-web/ai/headless';
import { RequireAiEnabled } from '@marinoscar/platform-web/ai/ui/require-ai-enabled';
import { VaultAiConfigProvider } from './platform/aiConfig';
import { vaultAiAdapters } from './platform/aiAdapters';
import { shellPreferencesPort } from './platform/shellPreferences';
import { appTelemetryAdapters } from './platform/telemetryAdapters';
import { AppTelemetryConfigProvider } from './platform/TelemetryConfigBinding';
import { VAULT_THEMES } from './theme';
import { Layout } from './components/common/Layout';
import { ErrorBoundary } from './components/common/ErrorBoundary';

// Pages (lazy loaded)
import { Suspense, lazy } from 'react';
import { LoadingSpinner } from './components/common/LoadingSpinner';

// The login page is the packaged one with Vault's brand in its slots; the
// callback, device activation, Access Tokens and Users & Allowlist pages are
// used as packaged.
const LoginPage = lazy(() => import('./identity/LoginPage'));
const AuthCallbackPage = lazy(() =>
  import('@marinoscar/platform-web/identity/ui').then((m) => ({ default: m.AuthCallbackPage })),
);
const ActivateDevicePage = lazy(() =>
  import('@marinoscar/platform-web/identity/ui').then((m) => ({ default: m.ActivateDevicePage })),
);
const UserTokensPage = lazy(() =>
  import('@marinoscar/platform-web/identity/ui').then((m) => ({ default: m.UserTokensPage })),
);
const UsersPage = lazy(() =>
  import('@marinoscar/platform-web/identity/ui').then((m) => ({ default: m.UsersPage })),
);
const HomePage = lazy(() => import('./pages/HomePage'));
// The two settings hubs and their card pages (E10.3, #94): config/adminSections.tsx
// and config/userSettingsSections.tsx declare the cards; each card path is a route below.
const UserSettingsHubPage = lazy(() => import('./pages/UserSettingsHubPage'));
const ProfileSettingsPage = lazy(() => import('./pages/settings/ProfileSettingsPage'));
const AppearanceSettingsPage = lazy(() => import('./pages/settings/AppearanceSettingsPage'));
const MyBackupsPage = lazy(() => import('./pages/settings/MyBackupsPage'));
const AdminSettingsHubPage = lazy(() => import('./pages/admin/AdminSettingsHubPage'));
const GeneralSettingsPage = lazy(() => import('./pages/admin/GeneralSettingsPage'));
// The AI card is the packaged AiConfigPage with Vault's card-scanning-model
// section in a slot; AI models and AI usage are the packaged pages as they are.
const AiSettingsPage = lazy(() => import('./pages/admin/AiSettingsPage'));
const AiModelsPage = lazy(() => import('@marinoscar/platform-web/ai/ui/models-page'));
const AiUsagePage = lazy(() => import('@marinoscar/platform-web/ai/ui/usage-page'));
const BackupSettingsPage = lazy(() => import('./pages/admin/BackupSettingsPage'));
// Packaged pages, read through the platform host (platform/platformHost.tsx).
const DoctorPage = lazy(() =>
  import('@marinoscar/platform-web/doctor/ui').then((m) => ({ default: m.DoctorPage })),
);
const AboutPage = lazy(() => import('@marinoscar/platform-web/host/ui').then((m) => ({ default: m.AboutPage })));
const MaintenancePage = lazy(() =>
  import('@marinoscar/platform-web/host/ui').then((m) => ({ default: m.MaintenancePage })),
);
// The packaged telemetry pages (E9.2, #90): one lazy chunk each, through the per-page entries.
const TelemetrySettingsPage = lazy(() => import('@marinoscar/platform-web/telemetry/ui/settings-page'));
const TelemetryExplorerPage = lazy(() => import('@marinoscar/platform-web/telemetry/ui/explorer-page'));
const TelemetryDashboardPage = lazy(() => import('@marinoscar/platform-web/telemetry/ui/dashboard-page'));
// The platform email and notifications slices' pages (E7.2); the slice is
// configured once in platform/notifications.ts (imported by main.tsx).
const EmailSettingsPage = lazy(() =>
  import('@marinoscar/platform-web/email/ui').then((m) => ({ default: m.EmailSettingsPage })),
);
const UserNotificationsPage = lazy(() =>
  import('@marinoscar/platform-web/notifications/ui').then((m) => ({ default: m.UserNotificationsPage })),
);
const PushConfigPage = lazy(() =>
  import('@marinoscar/platform-web/notifications/ui').then((m) => ({ default: m.PushConfigPage })),
);
const BroadcastsPage = lazy(() =>
  import('@marinoscar/platform-web/notifications/ui').then((m) => ({ default: m.BroadcastsPage })),
);
// E6.1 web follow-up (#84): the platform storage slice's configuration page. It
// takes no adapters: it reads the platform host (platform/platformHost.tsx).
const StorageConfigPage = lazy(() =>
  import('@marinoscar/platform-web/storage/ui').then((m) => ({ default: m.StorageConfigPage })),
);
const SecretsPage = lazy(() => import('./pages/SecretsPage'));
const CardsPage = lazy(() => import('./pages/CardsPage'));
const ImportCardPage = lazy(() => import('./pages/ImportCardPage'));
const RenewCardPage = lazy(() => import('./pages/RenewCardPage'));
const CreateSecretPage = lazy(() => import('./pages/CreateSecretPage'));
const SecretDetailPage = lazy(() => import('./pages/SecretDetailPage'));
const EditSecretPage = lazy(() => import('./pages/EditSecretPage'));
const SecretTypesPage = lazy(() => import('./pages/SecretTypesPage'));
const CreateSecretTypePage = lazy(() => import('./pages/CreateSecretTypePage'));
const EditSecretTypePage = lazy(() => import('./pages/EditSecretTypePage'));
const MediaFoldersPage = lazy(() => import('./pages/MediaFoldersPage'));
const CreateFolderPage = lazy(() => import('./pages/CreateFolderPage'));
const EditFolderPage = lazy(() => import('./pages/EditFolderPage'));
const MediaFolderPage = lazy(() => import('./pages/MediaFolderPage'));
const MediaUploadPage = lazy(() => import('./pages/MediaUploadPage'));
const RenameMediaFilePage = lazy(() => import('./pages/RenameMediaFilePage'));
const MediaPlayerPage = lazy(() => import('./pages/MediaPlayerPage'));

// Test login page (development only)
const TestLoginPage = import.meta.env.PROD
  ? null
  : lazy(() => import('./pages/TestLoginPage'));

/** Where a denied settings card page sends the viewer. */
const TO_HOME = <Navigate to="/" replace />;
const TO_SETTINGS = <Navigate to="/settings" replace />;

/** `/secret-types/:id/edit` (pre-E10.3 bookmark) to its page under the Secret types card. */
function SecretTypeEditRedirect() {
  const { id = '' } = useParams();
  return <Navigate to={`/settings/secret-types/${encodeURIComponent(id)}/edit`} replace />;
}

function AppRoutes() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingSpinner fullScreen />}>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />

          {/* Test login (development only) */}
          {!import.meta.env.PROD && TestLoginPage && (
            <Route path="/testing/login" element={<TestLoginPage />} />
          )}

          {/* Protected routes */}
          <Route element={<RequireAuth loading={<LoadingSpinner fullScreen />} />}>
            {/* Device activation page - without layout for full-screen experience */}
            <Route path="/activate" element={<ActivateDevicePage />} />

            <Route element={<Layout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/cards" element={<CardsPage />} />
              {/* Declared before /cards/:id would be, if that ever exists. */}
              <Route path="/cards/import" element={<ImportCardPage />} />
              {/* Renewal is NOT gated on AI availability — the wizard runs as
                  a manual edit-and-version when no OpenAI key is configured. */}
              <Route path="/cards/:id/renew" element={<RenewCardPage />} />
              <Route path="/secrets" element={<SecretsPage />} />
              <Route path="/secrets/new" element={<CreateSecretPage />} />
              <Route path="/secrets/:id" element={<SecretDetailPage />} />
              <Route path="/secrets/:id/edit" element={<EditSecretPage />} />

              {/* SETTINGS (E10.3). Every card route is gated on EXACTLY the
                  permission its card declares (the API controller's string),
                  as `__tests__/config/settingsRegistry.test.ts` asserts by
                  reading this file: keep `path` and the gate's `permission`
                  adjacent. Writes are gated inside each page. */}
              <Route path="/settings" element={<UserSettingsHubPage />} />
              <Route
                path="/settings/profile"
                element={<RequirePermission permission="user_settings:read" fallback={TO_SETTINGS}><ProfileSettingsPage /></RequirePermission>}
              />
              <Route
                path="/settings/appearance"
                element={<RequirePermission permission="user_settings:read" fallback={TO_SETTINGS}><AppearanceSettingsPage /></RequirePermission>}
              />
              {/* Ownership-scoped (the platform's pat.controller.ts, bare @Auth()): no gate. */}
              <Route path="/settings/tokens" element={<UserTokensPage />} />
              <Route
                path="/settings/backups"
                element={<RequirePermission permission="secrets:read" fallback={TO_SETTINGS}><MyBackupsPage /></RequirePermission>}
              />
              <Route
                path="/settings/secret-types"
                element={<RequirePermission permission="secret_types:read" fallback={TO_SETTINGS}><SecretTypesPage /></RequirePermission>}
              />
              <Route
                path="/settings/secret-types/new"
                element={<RequirePermission permission="secret_types:read" fallback={TO_SETTINGS}><CreateSecretTypePage /></RequirePermission>}
              />
              <Route
                path="/settings/secret-types/:id/edit"
                element={<RequirePermission permission="secret_types:read" fallback={TO_SETTINGS}><EditSecretTypePage /></RequirePermission>}
              />
              <Route
                path="/settings/notifications"
                element={<RequirePermission permission="user_settings:read" fallback={TO_SETTINGS}><UserNotificationsPage /></RequirePermission>}
              />
              {/* Pre-E10.3 bookmarks: real redirects, the target route gates. */}
              <Route path="/secret-types" element={<Navigate to="/settings/secret-types" replace />} />
              <Route path="/secret-types/new" element={<Navigate to="/settings/secret-types/new" replace />} />
              <Route path="/secret-types/:id/edit" element={<SecretTypeEditRedirect />} />

              {/* The Console hub: ANY-OF, in sync with the `console` destination's
                  `anyPermission` in config/destinations.ts. */}
              <Route
                path="/admin/settings"
                element={<RequirePermission permissions={['system_settings:read', 'users:read', 'push:read', 'broadcasts:read', 'ai_config:read', 'storage_config:read']} fallback={TO_HOME}><AdminSettingsHubPage /></RequirePermission>}
              />
              <Route
                path="/admin/settings/general"
                element={<RequirePermission permission="system_settings:read" fallback={TO_HOME}><GeneralSettingsPage /></RequirePermission>}
              />
              <Route
                path="/admin/settings/users"
                element={<RequirePermission permission="users:read" fallback={TO_HOME}><UsersPage /></RequirePermission>}
              />
              <Route
                path="/admin/settings/ai"
                element={<RequirePermission permission="ai_config:read" fallback={TO_HOME}><AiSettingsPage /></RequirePermission>}
              />
              {/* E8.2: the AI models and AI usage cards (feature 'ai'), beneath the AI
                  card at the paths the packaged pages link to; hidden while AI is off. */}
              <Route
                path="/admin/settings/ai/models"
                element={<RequirePermission permission="ai_config:read" fallback={TO_HOME}><RequireAiEnabled><AiModelsPage /></RequireAiEnabled></RequirePermission>}
              />
              <Route
                path="/admin/settings/ai/usage"
                element={<RequirePermission permission="ai_config:read" fallback={TO_HOME}><RequireAiEnabled><AiUsagePage /></RequireAiEnabled></RequirePermission>}
              />
              {/* E6.1 web follow-up (#84). `storage_config:read`, the string the platform's
                  storage-config controller enforces on its GET; writes need
                  `storage_config:write`, which the page gates. */}
              <Route
                path="/admin/settings/storage"
                element={<RequirePermission permission="storage_config:read" fallback={TO_HOME}><StorageConfigPage /></RequirePermission>}
              />
              <Route
                path="/admin/settings/backups"
                element={<RequirePermission permission="system_settings:read" fallback={TO_HOME}><BackupSettingsPage /></RequirePermission>}
              />
              <Route
                path="/admin/settings/maintenance"
                element={<RequirePermission permission="system_settings:read" fallback={TO_HOME}><MaintenancePage /></RequirePermission>}
              />
              <Route
                path="/admin/settings/doctor"
                element={<RequirePermission permission="system_settings:read" fallback={TO_HOME}><DoctorPage /></RequirePermission>}
              />
              <Route
                path="/admin/settings/about"
                element={<RequirePermission permission="system_settings:read" fallback={TO_HOME}><AboutPage /></RequirePermission>}
              />
              {/* E9.2 (#90). The platform telemetry slice's three pages, each gated on the exact
                  string its controller enforces: `telemetry:read` for the settings page (saving
                  needs `telemetry:write`, which the PAGE gates), `telemetry:query` for the Explorer
                  and the Dashboard. The settings page is NOT behind `RequireTelemetryEnabled`: it
                  is where telemetry is switched on. The other two are, matching `feature:
                  'telemetry'` on their cards. */}
              <Route
                path="/admin/settings/telemetry"
                element={<RequirePermission permission="telemetry:read" fallback={TO_HOME}><TelemetrySettingsPage /></RequirePermission>}
              />
              <Route
                path="/admin/settings/telemetry/explorer"
                element={<RequirePermission permission="telemetry:query" fallback={TO_HOME}><RequireTelemetryEnabled><TelemetryExplorerPage /></RequireTelemetryEnabled></RequirePermission>}
              />
              <Route
                path="/admin/settings/telemetry/dashboard"
                element={<RequirePermission permission="telemetry:query" fallback={TO_HOME}><RequireTelemetryEnabled><TelemetryDashboardPage /></RequireTelemetryEnabled></RequirePermission>}
              />
              <Route
                path="/admin/settings/email"
                element={<RequirePermission permission="system_settings:read" fallback={TO_HOME}><EmailSettingsPage /></RequirePermission>}
              />
              <Route
                path="/admin/settings/push"
                element={<RequirePermission permission="push:read" fallback={TO_HOME}><PushConfigPage /></RequirePermission>}
              />
              <Route
                path="/admin/settings/broadcasts"
                element={<RequirePermission permission="broadcasts:read" fallback={TO_HOME}><BroadcastsPage /></RequirePermission>}
              />
              <Route path="/admin" element={<Navigate to="/admin/settings" replace />} />
              <Route path="/admin/users" element={<Navigate to="/admin/settings/users" replace />} />
              <Route path="/media" element={<MediaFoldersPage />} />
              <Route path="/media/new-folder" element={<CreateFolderPage />} />
              <Route path="/media/:folderId/edit" element={<EditFolderPage />} />
              <Route path="/media/:folderId/upload" element={<MediaUploadPage />} />
              <Route path="/media/:folderId/:fileId/rename" element={<RenameMediaFilePage />} />
              <Route path="/media/:folderId/:fileId" element={<MediaPlayerPage />} />
              <Route path="/media/:folderId" element={<MediaFolderPage />} />
            </Route>
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

/**
 * The tree, outermost first: `ShellRoot` (the Vault themes, the viewer's
 * light / dark / system choice, CssBaseline), the platform's identity
 * providers (the session over Vault's one HTTP client, the identity pages'
 * adapters, the tables' layout store), the AI config (`GET /api/ai/config`
 * once signed in; the `ai` feature), the telemetry config and adapters, the platform host the packaged pages
 * read (Vault's client, the signed-in viewer, the theme setter), the AI
 * pages' adapters (Vault's spinner), and the shell's preferences port (the rail's collapse). The shell itself is
 * `components/common/Layout.tsx`, the layout route below.
 */
export default function App() {
  return (
    <ShellRoot themes={VAULT_THEMES}>
      <IdentityProviders>
        <VaultAiConfigProvider>
          {/* ABOVE the platform host: the `telemetry` settings feature the host reads is this answer
              (`GET /api/telemetry/config`, fetched once the session is authenticated). */}
          <AppTelemetryConfigProvider>
            <TelemetryWebAdaptersProvider adapters={appTelemetryAdapters}>
              <VaultPlatformHostProvider>
                <AiWebAdaptersProvider adapters={vaultAiAdapters}>
                  <ShellPreferencesProvider port={shellPreferencesPort}>
                    <AppRoutes />
                  </ShellPreferencesProvider>
                </AiWebAdaptersProvider>
              </VaultPlatformHostProvider>
            </TelemetryWebAdaptersProvider>
          </AppTelemetryConfigProvider>
        </VaultAiConfigProvider>
      </IdentityProviders>
    </ShellRoot>
  );
}
