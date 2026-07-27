import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Container,
  Typography,
  Box,
  Tab,
  Tabs,
  Breadcrumbs,
  Link,
  Alert,
  Snackbar,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from '@mui/material';
import { SecretDetail } from '../components/secrets/SecretDetail';
import { SecretVersionHistory } from '../components/secrets/SecretVersionHistory';
import { SecretAttachments } from '../components/secrets/SecretAttachments';
import { CardImages, supportsCardImages } from '../components/secrets/CardImages';
import { DynamicSecretFields } from '../components/secrets/DynamicSecretFields';
import { useSecretDetail } from '../hooks/useSecretDetail';
import type { SecretVersionDetailWithAttachments } from '../hooks/useSecretDetail';
import { deleteSecret } from '../services/api';

/**
 * Tabs are addressed by key, not by position.
 *
 * The Attachments tab is conditional, so with positional values the index of
 * every tab depends on which other tabs happen to be rendered — adding or
 * reordering one silently routes the panel body to the wrong tab. Keys make the
 * mapping independent of both.
 */
type TabKey = 'details' | 'versions' | 'attachments';

export default function SecretDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    secret,
    versions,
    isLoading,
    error,
    fetchSecret,
    fetchVersions,
    fetchVersion,
    rollback,
  } = useSecretDetail();
  const [activeTab, setActiveTab] = useState<TabKey>('details');
  const [versionDetailOpen, setVersionDetailOpen] = useState(false);
  const [selectedVersion, setSelectedVersion] =
    useState<SecretVersionDetailWithAttachments | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      fetchSecret(id);
      fetchVersions(id);
    }
  }, [id, fetchSecret, fetchVersions]);

  const handleDelete = useCallback(async () => {
    if (!id) return;
    await deleteSecret(id);
    navigate('/secrets');
  }, [id, navigate]);

  const handleViewVersion = useCallback(
    async (versionId: string) => {
      if (!id) return;
      const detail = await fetchVersion(id, versionId);
      setSelectedVersion(detail);
      setVersionDetailOpen(true);
    },
    [id, fetchVersion],
  );

  const handleRollback = useCallback(
    async (versionId: string) => {
      if (!id) return;
      await rollback(id, versionId);
      setSuccessMessage('Rolled back successfully');
      fetchSecret(id);
    },
    [id, rollback, fetchSecret],
  );

  const handleUploadComplete = useCallback(() => {
    if (id) fetchSecret(id);
  }, [id, fetchSecret]);

  const handleDeleteAttachment = useCallback(() => {
    if (id) fetchSecret(id);
  }, [id, fetchSecret]);

  if (isLoading && !secret) {
    return (
      <Container maxWidth="lg" sx={{ py: 3, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (!secret) {
    return (
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Alert severity="error">{error || 'Secret not found'}</Alert>
      </Container>
    );
  }

  const showAttachments = secret.type?.allowAttachments ?? false;
  const showCardImages = supportsCardImages(secret.type, secret.attachments ?? []);

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'details', label: 'Details' },
    { key: 'versions', label: 'Version History' },
    ...(showAttachments ? [{ key: 'attachments' as const, label: 'Attachments' }] : []),
  ];

  // A secret can finish loading as a type without attachments while
  // `activeTab` still holds a key that is no longer rendered. Fall back rather
  // than show an empty page under a Tabs bar with nothing selected.
  const currentTab: TabKey = tabs.some((t) => t.key === activeTab) ? activeTab : 'details';

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link color="inherit" href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
          Home
        </Link>
        <Link color="inherit" href="/secrets" onClick={(e) => { e.preventDefault(); navigate('/secrets'); }}>
          Secrets
        </Link>
        <Typography color="text.primary">{secret.name}</Typography>
      </Breadcrumbs>

      <Typography variant="h4" gutterBottom>
        {secret.name}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={currentTab} onChange={(_, v: TabKey) => setActiveTab(v)}>
          {tabs.map((tab) => (
            <Tab key={tab.key} value={tab.key} label={tab.label} />
          ))}
        </Tabs>
      </Box>

      {currentTab === 'details' && (
        <SecretDetail
          secret={secret}
          onEdit={() => navigate(`/secrets/${id}/edit`)}
          onDelete={handleDelete}
        />
      )}

      {currentTab === 'versions' && (
        <SecretVersionHistory
          versions={versions}
          isLoading={isLoading}
          onViewVersion={handleViewVersion}
          onRollback={handleRollback}
        />
      )}

      {currentTab === 'attachments' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* Card faces live here rather than on the Details tab so a card
              number and a photo of the card are never on the same screen. */}
          {showCardImages && (
            <CardImages
              secretId={secret.id}
              attachments={secret.attachments ?? []}
              onChange={handleUploadComplete}
            />
          )}
          <SecretAttachments
            attachments={secret.attachments || []}
            secretId={secret.id}
            onUploadComplete={handleUploadComplete}
            onDelete={handleDeleteAttachment}
          />
        </Box>
      )}

      {/* Version detail dialog */}
      <Dialog
        open={versionDetailOpen}
        onClose={() => setVersionDetailOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Version {selectedVersion?.version}</DialogTitle>
        <DialogContent>
          {selectedVersion && secret && (
            <Box sx={{ pt: 1 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Created: {new Date(selectedVersion.createdAt).toLocaleString()}
                {selectedVersion.createdBy && ` by ${selectedVersion.createdBy.email}`}
              </Typography>
              <DynamicSecretFields
                fields={secret.type?.fields ?? []}
                data={selectedVersion.values}
                onChange={() => {}}
                readOnly
              />
              {/* Deliberately the *version's* attachments, not the secret's:
                  viewing v1 of a renewed card must show v1's photo. Read-only
                  because a historical version is immutable. */}
              {supportsCardImages(secret.type, selectedVersion.attachments ?? []) && (
                <Box sx={{ mt: 3 }}>
                  <CardImages
                    secretId={secret.id}
                    attachments={selectedVersion.attachments ?? []}
                    readOnly
                    title={`Card Images (v${selectedVersion.version})`}
                  />
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVersionDetailOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!successMessage}
        autoHideDuration={3000}
        onClose={() => setSuccessMessage(null)}
      >
        <Alert severity="success">{successMessage}</Alert>
      </Snackbar>
    </Container>
  );
}
