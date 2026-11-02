import { Routes, Route, Navigate } from 'react-router-dom';
import { ShellPreferencesProvider } from '@marinoscar/platform-web/shell/headless';
import { ShellRoot } from '@marinoscar/platform-web/shell/ui';
import { AuthProvider } from './contexts/AuthContext';
import { PlatformAuthBridge } from './platform/PlatformAuthBridge';
import { shellPreferencesPort } from './platform/shellPreferences';
import { VAULT_THEMES } from './theme';
import { ProtectedRoute } from './components/common/ProtectedRoute';
import { Layout } from './components/common/Layout';
import { ErrorBoundary } from './components/common/ErrorBoundary';

// Pages (lazy loaded)
import { Suspense, lazy } from 'react';
import { LoadingSpinner } from './components/common/LoadingSpinner';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const AuthCallbackPage = lazy(() => import('./pages/AuthCallbackPage'));
const ActivateDevicePage = lazy(() => import('./pages/ActivateDevicePage'));
const HomePage = lazy(() => import('./pages/HomePage'));
const UserSettingsPage = lazy(() => import('./pages/UserSettingsPage'));
const SystemSettingsPage = lazy(() => import('./pages/SystemSettingsPage'));
const UserManagementPage = lazy(() => import('./pages/UserManagementPage'));
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
          <Route element={<ProtectedRoute />}>
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
              <Route path="/secret-types" element={<SecretTypesPage />} />
              <Route path="/secret-types/new" element={<CreateSecretTypePage />} />
              <Route path="/secret-types/:id/edit" element={<EditSecretTypePage />} />
              <Route path="/settings" element={<UserSettingsPage />} />
              <Route path="/admin/users" element={<UserManagementPage />} />
              <Route path="/admin/settings" element={<SystemSettingsPage />} />
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
 * light / dark / system choice, CssBaseline), Vault's own session, the bridge
 * that re-publishes it to the platform's identity context the shell reads,
 * and the shell's preferences port (the rail's collapse). The shell itself is
 * `components/common/Layout.tsx`, the layout route below.
 */
export default function App() {
  return (
    <ShellRoot themes={VAULT_THEMES}>
      <AuthProvider>
        <PlatformAuthBridge>
          <ShellPreferencesProvider port={shellPreferencesPort}>
            <AppRoutes />
          </ShellPreferencesProvider>
        </PlatformAuthBridge>
      </AuthProvider>
    </ShellRoot>
  );
}
