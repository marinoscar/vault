import { useRef, useState } from 'react';
import {
  Box,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Button,
  Typography,
  CircularProgress,
  Alert,
} from '@mui/material';
import {
  AttachFile as AttachFileIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
  Upload as UploadIcon,
} from '@mui/icons-material';
import { api, linkSecretAttachment } from '../../services/api';
import type { SecretAttachment } from '../../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

interface SecretAttachmentsProps {
  attachments: SecretAttachment[];
  secretId: string;
  onUploadComplete: () => void;
  onDelete: (attachmentId: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SecretAttachments({
  attachments,
  secretId,
  onUploadComplete,
  onDelete,
}: SecretAttachmentsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleUploadClick = () => {
    setUploadError(null);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so same file can be re-selected
    e.target.value = '';

    // Client-side size check (50 MB limit)
    const MAX_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      setUploadError('File must be under 50 MB');
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      // Upload via storage API using multipart form data
      const formData = new FormData();
      formData.append('file', file);

      const accessToken = api.getAccessToken();
      const headers: HeadersInit = {};
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const uploadResponse = await fetch(`${API_BASE_URL}/storage/objects`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: formData,
      });

      if (!uploadResponse.ok) {
        const err = await uploadResponse.json().catch(() => ({}));
        throw new Error(err.message || 'Upload failed');
      }

      const uploadData = await uploadResponse.json();
      const storageObject = uploadData.data ?? uploadData;

      // Link the storage object to the secret
      await linkSecretAttachment(secretId, storageObject.id, file.name);

      onUploadComplete();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (attachmentId: string, fileName: string) => {
    try {
      const accessToken = api.getAccessToken();
      const headers: HeadersInit = {};
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const response = await fetch(`${API_BASE_URL}/storage/objects/${attachmentId}/download`, {
        headers,
        credentials: 'include',
      });

      if (!response.ok) throw new Error('Download failed');

      const data = await response.json();
      const result = data.data ?? data;
      const url = result.url ?? result.signedUrl ?? result.downloadUrl;
      if (url) {
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.click();
      }
    } catch {
      // Silently fail — could be enhanced with a toast notification
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle2">Attachments</Typography>
        <Button
          size="small"
          variant="outlined"
          startIcon={uploading ? <CircularProgress size={14} /> : <UploadIcon />}
          onClick={handleUploadClick}
          disabled={uploading}
        >
          {uploading ? 'Uploading...' : 'Upload'}
        </Button>
      </Box>

      <input
        ref={fileInputRef}
        type="file"
        hidden
        onChange={handleFileChange}
      />

      {uploadError && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setUploadError(null)}>
          {uploadError}
        </Alert>
      )}

      {attachments.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No attachments yet.
        </Typography>
      ) : (
        <List dense disablePadding>
          {attachments.map((attachment) => (
            <ListItem key={attachment.id} disableGutters>
              <ListItemIcon sx={{ minWidth: 36 }}>
                <AttachFileIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={attachment.label ?? attachment.storageObject.name}
                secondary={formatBytes(attachment.storageObject.size)}
                primaryTypographyProps={{ variant: 'body2' }}
                secondaryTypographyProps={{ variant: 'caption' }}
              />
              <ListItemSecondaryAction>
                <IconButton
                  size="small"
                  onClick={() =>
                    handleDownload(
                      attachment.storageObject.id,
                      attachment.label ?? attachment.storageObject.name,
                    )
                  }
                  aria-label="Download attachment"
                >
                  <DownloadIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => onDelete(attachment.id)}
                  aria-label="Delete attachment"
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </ListItemSecondaryAction>
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );
}
