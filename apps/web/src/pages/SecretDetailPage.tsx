import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  Link,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Snackbar,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  Autorenew as RenewIcon,
  DeleteOutlined as DeleteIcon,
  Download as DownloadIcon,
  EditOutlined as EditIcon,
  History as HistoryIcon,
  MoreVert as MoreIcon,
} from '@mui/icons-material';
import { SecretAttachments } from '../components/secrets/SecretAttachments';
import { CardImages, supportsCardImages } from '../components/secrets/CardImages';
import { SecretTypeIcon } from '../components/secrets/SecretTypeIcon';
import { SecretValueField } from '../components/secrets/SecretValueField';
import { SecretVersionDrawer } from '../components/secrets/SecretVersionDrawer';
import { useSecretDetail } from '../hooks/useSecretDetail';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';
import { deleteSecret, unlinkSecretAttachment } from '../services/api';
import { formatRelativeTime, isCardType } from '../utils/secretFields';

/**
 * Details and Attachments are parallel content of one destination, so they
 * are tabs (addressed by key: the Attachments tab is conditional). Keeping
 * card photos on their own tab means a card number and a photo of the card
 * are never on the same screen.
 */
type TabKey = 'details' | 'attachments';

/** One channel for both outcomes, so a failure never looks like a success. */
type Toast = { severity: 'success' | 'error'; message: string };

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ py: 1 }}>
      <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ overflowWrap: 'anywhere' }}>
        {children}
      </Typography>
    </Box>
  );
}

/**
 * A secret (E10.4, issue #95): header with the type, name and last update;
 * masked fields with reveal and copy; an Attachments tab; version history and
 * rollback in a drawer; Edit and Delete. Card-type secrets also link to the
 * Cards renewal flow.
 */
export default function SecretDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission('secrets:write');
  const canDelete = hasPermission('secrets:delete');
  const { secret, versions, isLoading, error, fetchSecret, fetchVersions, fetchVersion, rollback } =
    useSecretDetail();
  const [activeTab, setActiveTab] = useState<TabKey>('details');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [pendingDeleteAttachmentId, setPendingDeleteAttachmentId] = useState<string | null>(null);
  const [deletingAttachment, setDeletingAttachment] = useState(false);

  useEffect(() => {
    if (id) {
      fetchSecret(id);
      fetchVersions(id);
    }
  }, [id, fetchSecret, fetchVersions]);

  const loadVersion = useCallback(
    (versionId: string) => fetchVersion(id ?? '', versionId),
    [id, fetchVersion],
  );

  const handleRollback = useCallback(
    async (versionId: string) => {
      if (!id) return;
      await rollback(id, versionId);
      setToast({ severity: 'success', message: 'Version restored as the current version' });
    },
    [id, rollback],
  );

  const handleDelete = useCallback(async () => {
    if (!id) return;
    setDeleting(true);
    try {
      await deleteSecret(id);
      navigate('/secrets');
    } catch (err) {
      setConfirmDelete(false);
      setToast({
        severity: 'error',
        message: err instanceof Error ? err.message : 'Failed to delete secret',
      });
    } finally {
      setDeleting(false);
    }
  }, [id, navigate]);

  const refresh = useCallback(() => {
    if (id) fetchSecret(id);
  }, [id, fetchSecret]);

  /**
   * Unlinking is not recoverable from the UI: the API refcount-deletes the
   * storage object once nothing references it. Hence the confirm, and a loud
   * failure.
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

  const downloadJson = () => {
    if (!secret) return;
    const payload = { name: secret.name, type: secret.type?.name ?? 'unknown', ...secret.values };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${secret.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading && !secret) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress aria-label="Loading secret" />
      </Box>
    );
  }

  if (!secret) {
    return (
      <Box sx={{ maxWidth: 1100, mx: 'auto' }}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" component={RouterLink} to="/secrets">
              Back to secrets
            </Button>
          }
        >
          {error || 'Secret not found'}
        </Alert>
      </Box>
    );
  }

  const fields = secret.type?.fields ?? [];
  const attachments = secret.attachments ?? [];
  const showAttachments = secret.type?.allowAttachments ?? false;
  const showCardImages = supportsCardImages(secret.type, attachments);
  const isCard = isCardType(secret.type);
  const currentTab: TabKey = showAttachments ? activeTab : 'details';
  const pendingDeleteAttachment = attachments.find((a) => a.id === pendingDeleteAttachmentId);

  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto', minWidth: 0 }}>
      <Button
        component={RouterLink}
        to="/secrets"
        startIcon={<BackIcon />}
        size="small"
        sx={{ mb: 1.5, ml: -1, color: 'text.secondary' }}
      >
        Secrets
      </Button>

      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          gap: 2,
          mb: 2,
          minWidth: 0,
        }}
      >
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flex: '1 1 280px', minWidth: 0 }}>
          <Avatar
            variant="rounded"
            aria-hidden
            sx={{ width: 48, height: 48, bgcolor: 'action.selected', color: 'primary.main' }}
          >
            <SecretTypeIcon icon={secret.type?.icon ?? null} />
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h5" component="h1" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
              {secret.name}
            </Typography>
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                columnGap: 1,
                rowGap: 0.5,
                mt: 0.5,
                color: 'text.secondary',
              }}
            >
              {secret.type && (
                <Chip
                  icon={<SecretTypeIcon icon={secret.type.icon} fontSize="small" />}
                  label={secret.type.name}
                  size="small"
                  variant="outlined"
                />
              )}
              <Tooltip title={new Date(secret.updatedAt).toLocaleString()}>
                <Typography variant="body2" component="span">
                  Updated {formatRelativeTime(secret.updatedAt)}
                </Typography>
              </Tooltip>
              <Typography variant="body2" component="span" aria-hidden>
                ·
              </Typography>
              <Typography variant="body2" component="span">
                v{secret.currentVersion}
              </Typography>
            </Box>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexShrink: 0, ml: { xs: 0, sm: 'auto' } }}>
          <Button variant="outlined" startIcon={<HistoryIcon />} onClick={() => setHistoryOpen(true)}>
            History
          </Button>
          {canWrite && (
            <Button
              variant="contained"
              startIcon={<EditIcon />}
              onClick={() => navigate(`/secrets/${secret.id}/edit`)}
            >
              Edit
            </Button>
          )}
          <IconButton
            aria-label="More actions"
            aria-haspopup="menu"
            onClick={(e) => setMenuAnchor(e.currentTarget)}
          >
            <MoreIcon />
          </IconButton>
          <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
            {isCard && canWrite && (
              <MenuItem
                onClick={() => {
                  setMenuAnchor(null);
                  navigate(`/cards/${secret.id}/renew`);
                }}
              >
                <ListItemIcon>
                  <RenewIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary="Renew card" />
              </MenuItem>
            )}
            <MenuItem
              onClick={() => {
                setMenuAnchor(null);
                downloadJson();
              }}
            >
              <ListItemIcon>
                <DownloadIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Download JSON" />
            </MenuItem>
            {canDelete && (
              <MenuItem
                onClick={() => {
                  setMenuAnchor(null);
                  setConfirmDelete(true);
                }}
                sx={{ color: 'error.main' }}
              >
                <ListItemIcon sx={{ color: 'error.main' }}>
                  <DeleteIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary="Delete" />
              </MenuItem>
            )}
          </Menu>
        </Box>
      </Box>

      {secret.description && (
        <Typography variant="body1" sx={{ color: 'text.secondary', mb: 2, whiteSpace: 'pre-wrap' }}>
          {secret.description}
        </Typography>
      )}

      {isCard && (
        <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
          This card is also in{' '}
          <Link component={RouterLink} to="/cards">
            Cards
          </Link>
          {canWrite && (
            <>
              , where you can{' '}
              <Link component={RouterLink} to={`/cards/${secret.id}/renew`}>
                renew it with new photos
              </Link>
            </>
          )}
          .
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {showAttachments && (
        <Tabs
          value={currentTab}
          onChange={(_, v: TabKey) => setActiveTab(v)}
          sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab value="details" label="Details" />
          <Tab
            value="attachments"
            label={attachments.length > 0 ? `Attachments (${attachments.length})` : 'Attachments'}
          />
        </Tabs>
      )}

      {currentTab === 'details' && (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 8 }}>
            <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
              {fields.length === 0 ? (
                <Typography variant="body2" sx={{ color: 'text.secondary', p: 2 }}>
                  No fields defined for this secret type.
                </Typography>
              ) : (
                fields.map((field, index) => {
                  const raw = secret.values?.[field.name];
                  return (
                    <Box key={field.name}>
                      {index > 0 && <Divider />}
                      <SecretValueField
                        field={field}
                        value={raw === undefined || raw === null ? '' : String(raw)}
                      />
                    </Box>
                  );
                })
              )}
            </Paper>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <Paper variant="outlined" sx={{ borderRadius: 2, px: 2, py: 1 }}>
              <MetaRow label="Version">v{secret.currentVersion}</MetaRow>
              <MetaRow label="Updated">{new Date(secret.updatedAt).toLocaleString()}</MetaRow>
              <MetaRow label="Created">{new Date(secret.createdAt).toLocaleString()}</MetaRow>
              {secret.createdBy && <MetaRow label="Created by">{secret.createdBy.email}</MetaRow>}
            </Paper>
          </Grid>
        </Grid>
      )}

      {currentTab === 'attachments' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {showCardImages && (
            <CardImages
              secretId={secret.id}
              attachments={attachments}
              onChange={refresh}
              readOnly={!canWrite}
            />
          )}
          <SecretAttachments
            attachments={attachments}
            secretId={secret.id}
            onUploadComplete={refresh}
            onDelete={setPendingDeleteAttachmentId}
          />
        </Box>
      )}

      <SecretVersionDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        secret={secret}
        versions={versions}
        loadVersion={loadVersion}
        onRollback={canWrite ? handleRollback : undefined}
      />

      <Dialog open={confirmDelete} onClose={() => !deleting && setConfirmDelete(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete secret?</DialogTitle>
        <DialogContent>
          <Typography>
            <strong>{secret.name}</strong> and all of its versions will be permanently deleted. This
            cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={() => void handleDelete()} disabled={deleting}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

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
          <Button onClick={() => setPendingDeleteAttachmentId(null)} disabled={deletingAttachment}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void confirmDeleteAttachment()}
            disabled={deletingAttachment}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!toast}
        autoHideDuration={toast?.severity === 'error' ? null : 3000}
        onClose={() => setToast(null)}
      >
        <Alert severity={toast?.severity ?? 'success'} onClose={() => setToast(null)}>
          {toast?.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
