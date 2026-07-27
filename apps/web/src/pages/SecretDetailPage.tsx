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
import { deleteSecret, unlinkSecretAttachment } from '../services/api';

/**
 * Tabs are addressed by key, not by position.
 *
 * The Attachments tab is conditional, so with positional values the index of
 * every tab depends on which other tabs happen to be rendered — adding or
 * reordering one silently routes the panel body to the wrong tab. Keys make the
 * mapping independent of both.
 */
type TabKey = 'details' | 'versions' | 'attachments';

/**
 * One channel for both outcomes of an action, so a failure cannot be reported
 * through the success-shaped affordance. Errors are not auto-hidden — a delete
 * that silently did nothing is exactly the bug this replaced.
 */
type Toast = { severity: 'success' | 'error'; message: string };

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
  const [toast, setToast] = useState<Toast | null>(null);
  const [pendingDeleteAttachmentId, setPendingDeleteAttachmentId] = useState<string | null>(null);
  const [deletingAttachment, setDeletingAttachment] = useState(false);

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
      setToast({ severity: 'success', message: 'Rolled back successfully' });
      fetchSecret(id);
    },
    [id, rollback, fetchSecret],
  );

  const handleUploadComplete = useCallback(() => {
    if (id) fetchSecret(id);
  }, [id, fetchSecret]);

  const handleDeleteAttachment = useCallback((attachmentId: string) => {
    setPendingDeleteAttachmentId(attachmentId);
  }, []);

  /**
   * Unlinking is not recoverable from the UI: the API refcount-deletes the
   * underlying storage object once no other attachment row references it, so a
   * file with a single reference is gone from S3 as well. Hence the confirm,
   * and hence the failure has to be loud — the previous handler only refetched,
   * which made a no-op indistinguishable from a successful delete.
   */
  const confirmDeleteAttachment = useCallback(async () => {
    if (!id || !pendingDeleteAttachmentId) return;
    setDeletingAttachment(true);
    try {
      await unlinkSecretAttachment(id, pendingDeleteAttachmentId);
      setPendingDeleteAttachmentId(null);
      await fetchSecret(id);
      setToast({ severity: 'success', message: 'Attachment deleted' });
    } catch (err) {
      setPendingDeleteAttachmentId(null);
      setToast({
        severity: 'error',
        message: err instanceof Error ? err.message : 'Failed to delete attachment',
      });
    } finally {
      setDeletingAttachment(false);
    }
  }, [id, pendingDeleteAttachmentId, fetchSecret]);

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
  const pendingDeleteAttachment = (secret.attachments ?? []).find(
    (a) => a.id === pendingDeleteAttachmentId,
  );

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

      {/* Attachment delete confirmation — mirrors the secret delete dialog in
          `SecretDetail`, because unlinking is equally irreversible. */}
      <Dialog
        open={!!pendingDeleteAttachmentId}
        onClose={() => {
          if (!deletingAttachment) setPendingDeleteAttachmentId(null);
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete Attachment</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete{' '}
            <strong>
              {pendingDeleteAttachment?.label ??
                pendingDeleteAttachment?.storageObject.name ??
                'this attachment'}
            </strong>
            ? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setPendingDeleteAttachmentId(null)}
            disabled={deletingAttachment}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={confirmDeleteAttachment}
            disabled={deletingAttachment}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!toast}
        // An error stays until dismissed; a success may fade.
        autoHideDuration={toast?.severity === 'error' ? null : 3000}
        onClose={() => setToast(null)}
      >
        <Alert severity={toast?.severity ?? 'success'} onClose={() => setToast(null)}>
          {toast?.message}
        </Alert>
      </Snackbar>
    </Container>
  );
}
