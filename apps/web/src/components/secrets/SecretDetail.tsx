import { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  CardActions,
  Button,
  Typography,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { DynamicSecretFields } from './DynamicSecretFields';
import { SecretTypeIcon } from './SecretTypeIcon';
import type { SecretDetail as SecretDetailType } from '../../types';

interface SecretDetailProps {
  secret: SecretDetailType;
  onEdit: () => void;
  onDelete: () => void;
}

export function SecretDetail({ secret, onEdit, onDelete }: SecretDetailProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const handleDeleteConfirm = () => {
    setDeleteDialogOpen(false);
    onDelete();
  };

  return (
    <>
      <Card>
        <CardContent>
          {/* Header metadata */}
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
            <Box>
              <Typography variant="h6">{secret.name}</Typography>
              {secret.description && (
                <Typography variant="body2" color="text.secondary">
                  {secret.description}
                </Typography>
              )}
            </Box>
            {secret.type && (
              <Chip
                icon={<SecretTypeIcon icon={secret.type.icon} fontSize="small" />}
                label={secret.type.name}
                size="small"
                variant="outlined"
              />
            )}
          </Box>

          <Box sx={{ display: 'flex', gap: 3, mb: 3, flexWrap: 'wrap' }}>
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Version
              </Typography>
              <Typography variant="body2">v{secret.currentVersion}</Typography>
            </Box>
            {secret.createdBy && (
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  Created by
                </Typography>
                <Typography variant="body2">{secret.createdBy.email}</Typography>
              </Box>
            )}
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Created
              </Typography>
              <Typography variant="body2">
                {new Date(secret.createdAt).toLocaleString()}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Updated
              </Typography>
              <Typography variant="body2">
                {new Date(secret.updatedAt).toLocaleString()}
              </Typography>
            </Box>
          </Box>

          <Divider sx={{ mb: 3 }} />

          {/* Secret field data */}
          {(secret.type?.fields?.length ?? 0) > 0 ? (
            <DynamicSecretFields
              fields={secret.type.fields}
              data={secret.data}
              onChange={() => {
                // read-only — no-op
              }}
              readOnly
            />
          ) : (
            <Typography variant="body2" color="text.secondary">
              No fields defined for this secret type.
            </Typography>
          )}
        </CardContent>

        <CardActions sx={{ justifyContent: 'flex-end', px: 2, pb: 2 }}>
          <Button
            variant="outlined"
            startIcon={<EditIcon />}
            onClick={onEdit}
          >
            Edit
          </Button>
          <Button
            variant="outlined"
            color="error"
            startIcon={<DeleteIcon />}
            onClick={() => setDeleteDialogOpen(true)}
          >
            Delete
          </Button>
        </CardActions>
      </Card>

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete Secret</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete <strong>{secret.name}</strong>? This action cannot be
            undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDeleteConfirm}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
