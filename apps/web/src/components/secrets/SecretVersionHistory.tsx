import { useState } from 'react';
import {
  Box,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  Button,
  Typography,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import type { SecretVersion } from '../../types';

interface SecretVersionHistoryProps {
  versions: SecretVersion[];
  isLoading: boolean;
  onViewVersion: (versionId: string) => void;
  onRollback: (versionId: string) => void;
}

export function SecretVersionHistory({
  versions,
  isLoading,
  onViewVersion,
  onRollback,
}: SecretVersionHistoryProps) {
  const [rollbackTarget, setRollbackTarget] = useState<SecretVersion | null>(null);

  const handleRollbackConfirm = () => {
    if (rollbackTarget) {
      onRollback(rollbackTarget.id);
      setRollbackTarget(null);
    }
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (versions.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
        No version history available.
      </Typography>
    );
  }

  return (
    <>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Version</TableCell>
              <TableCell>Created At</TableCell>
              <TableCell>Created By</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {versions.map((version) => (
              <TableRow
                key={version.id}
                hover
                onClick={() => onViewVersion(version.id)}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    v{version.version}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {new Date(version.createdAt).toLocaleString()}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {version.createdBy ? version.createdBy.email : '—'}
                  </Typography>
                </TableCell>
                <TableCell>
                  {version.isCurrent ? (
                    <Chip label="Current" color="success" size="small" />
                  ) : (
                    <Chip label={`v${version.version}`} size="small" variant="outlined" />
                  )}
                </TableCell>
                <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                  {!version.isCurrent && (
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => setRollbackTarget(version)}
                    >
                      Rollback
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>

      {/* Rollback confirmation dialog */}
      <Dialog
        open={Boolean(rollbackTarget)}
        onClose={() => setRollbackTarget(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Rollback to Version {rollbackTarget?.version}</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to roll back to{' '}
            <strong>v{rollbackTarget?.version}</strong>? This will create a new version
            with the data from that point in time.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRollbackTarget(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleRollbackConfirm}>
            Rollback
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
