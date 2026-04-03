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
import { DynamicSecretFields } from '../components/secrets/DynamicSecretFields';
import { useSecretDetail } from '../hooks/useSecretDetail';
import { deleteSecret } from '../services/api';
import type { SecretVersionDetail } from '../types';

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
  const [activeTab, setActiveTab] = useState(0);
  const [versionDetailOpen, setVersionDetailOpen] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<SecretVersionDetail | null>(null);
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

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link
          color="inherit"
          href="/secrets"
          onClick={(e) => {
            e.preventDefault();
            navigate('/secrets');
          }}
        >
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
        <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)}>
          <Tab label="Details" />
          <Tab label="Version History" />
          {showAttachments && <Tab label="Attachments" />}
        </Tabs>
      </Box>

      {activeTab === 0 && (
        <SecretDetail
          secret={secret}
          onEdit={() => navigate(`/secrets/${id}/edit`)}
          onDelete={handleDelete}
        />
      )}

      {activeTab === 1 && (
        <SecretVersionHistory
          versions={versions}
          isLoading={isLoading}
          onViewVersion={handleViewVersion}
          onRollback={handleRollback}
        />
      )}

      {activeTab === 2 && showAttachments && (
        <SecretAttachments
          attachments={secret.attachments || []}
          secretId={secret.id}
          onUploadComplete={handleUploadComplete}
          onDelete={handleDeleteAttachment}
        />
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
