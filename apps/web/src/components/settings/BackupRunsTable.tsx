import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteIcon from '@mui/icons-material/Delete';
import type { BackupRun, BackupRunStatus } from '../../types';
import { backupRunContentChips } from '../../utils/backupContents';
import { formatBytes, formatDateTime } from '../../utils/backupSchedule';

const STATUS_CHIP: Record<BackupRunStatus, { label: string; color: 'info' | 'success' | 'error' }> =
  {
    running: { label: 'Running', color: 'info' },
    succeeded: { label: 'Succeeded', color: 'success' },
    failed: { label: 'Failed', color: 'error' },
  };

/** Status of a run, plus Deleted and warning-count chips. */
export function RunStatusChip({ run }: { run: BackupRun }) {
  const { label, color } = STATUS_CHIP[run.status] ?? STATUS_CHIP.failed;
  return (
    <Stack
      direction="row"
      spacing={0.5}
      useFlexGap
      sx={{
        alignItems: "center",
        flexWrap: "wrap"
      }}>
      <Chip
        size="small"
        label={label}
        color={color}
        icon={run.status === 'running' ? <CircularProgress size={12} color="inherit" /> : undefined}
      />
      {run.deletedAt && <Chip size="small" label="Deleted" variant="outlined" />}
      {run.warningCount > 0 && (
        <Chip
          size="small"
          variant="outlined"
          color="warning"
          label={`${run.warningCount} warning${run.warningCount === 1 ? '' : 's'}`}
        />
      )}
    </Stack>
  );
}

/** What a run backed up, as small chips (Secrets, Media, System). */
export function RunContentChips({ run }: { run: BackupRun }) {
  const labels = backupRunContentChips(run.contents);
  if (labels.length === 0) {
    return (
      <Typography variant="body2" sx={{
        color: "text.secondary"
      }}>—
              </Typography>
    );
  }
  return (
    <Stack
      direction="row"
      spacing={0.5}
      useFlexGap
      aria-label="Backup contents"
      data-testid={`backup-contents-${run.id}`}
      sx={{
        flexWrap: "wrap"
      }}
    >
      {labels.map((label) => (
        <Chip key={label} size="small" variant="outlined" label={label} />
      ))}
    </Stack>
  );
}

export interface BackupRunsTableProps {
  runs: BackupRun[];
  total: number;
  page: number;
  rowsPerPage: number;
  loading: boolean;
  /** Show the Download / Delete actions column. */
  showActions: boolean;
  busyId: string | null;
  onPageChange: (page: number) => void;
  onRowsPerPageChange: (rows: number) => void;
  onDownload: (run: BackupRun) => void;
  onDelete: (run: BackupRun) => void;
  /** Accessible name of the table. */
  ariaLabel: string;
  emptyText: string;
  /** Admin history: the Trigger and Users / Secrets / Attachments / Media columns. */
  showAdminColumns?: boolean;
  downloadLabel?: string;
  deleteLabel?: string;
}

/**
 * Paginated table of backup runs: started, status (with the run error),
 * size, contents chips and the Download / Delete actions. Used by the admin
 * backup history and the user's "My saved backups".
 */
export function BackupRunsTable({
  runs,
  total,
  page,
  rowsPerPage,
  loading,
  showActions,
  busyId,
  onPageChange,
  onRowsPerPageChange,
  onDownload,
  onDelete,
  ariaLabel,
  emptyText,
  showAdminColumns = false,
  downloadLabel = 'Download backup',
  deleteLabel = 'Delete backup',
}: BackupRunsTableProps) {
  if (loading && runs.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }
  if (runs.length === 0) {
    return (
      <Typography
        sx={{
          color: "text.secondary",
          p: 2
        }}>
        {emptyText}
      </Typography>
    );
  }

  const wideOnly = { display: { xs: 'none', sm: 'table-cell' } };

  return (
    <>
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small" aria-label={ariaLabel}>
          <TableHead>
            <TableRow>
              <TableCell>Started</TableCell>
              {showAdminColumns && <TableCell sx={wideOnly}>Trigger</TableCell>}
              <TableCell>Status</TableCell>
              <TableCell>Size</TableCell>
              <TableCell>Contents</TableCell>
              {showAdminColumns && (
                <TableCell sx={wideOnly}>Users / Secrets / Attachments / Media files</TableCell>
              )}
              {showActions && <TableCell align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.id} hover>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  {formatDateTime(run.startedAt) ?? '—'}
                </TableCell>
                {showAdminColumns && (
                  <TableCell sx={wideOnly}>
                    {run.trigger === 'manual' ? 'Manual' : 'Scheduled'}
                    {run.trigger === 'manual' && run.triggeredBy && (
                      <Typography
                        variant="caption"
                        sx={{
                          color: "text.secondary",
                          display: "block"
                        }}>
                        {run.triggeredBy.displayName || run.triggeredBy.email}
                      </Typography>
                    )}
                  </TableCell>
                )}
                <TableCell>
                  <RunStatusChip run={run} />
                  {run.error && (
                    <Typography
                      variant="caption"
                      color="error"
                      sx={{
                        display: "block",
                        mt: 0.5,
                        maxWidth: 280,
                        wordBreak: 'break-word'
                      }}>
                      {run.error}
                    </Typography>
                  )}
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatBytes(run.sizeBytes)}</TableCell>
                <TableCell>
                  <RunContentChips run={run} />
                </TableCell>
                {showAdminColumns && (
                  <TableCell sx={wideOnly}>
                    {run.userCount} / {run.secretCount} / {run.attachmentCount} /{' '}
                    {run.mediaFileCount ?? 0}
                  </TableCell>
                )}
                {showActions && (
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Tooltip title="Download">
                      <span>
                        <IconButton
                          aria-label={downloadLabel}
                          size="small"
                          onClick={() => onDownload(run)}
                          disabled={!run.downloadable || busyId === run.id}
                        >
                          <DownloadIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <span>
                        <IconButton
                          aria-label={deleteLabel}
                          size="small"
                          onClick={() => onDelete(run)}
                          disabled={
                            run.status === 'running' || !!run.deletedAt || busyId === run.id
                          }
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={total}
        page={page}
        onPageChange={(_, p) => onPageChange(p)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(e) => onRowsPerPageChange(Number.parseInt(e.target.value, 10))}
        rowsPerPageOptions={[10, 20, 50]}
      />
    </>
  );
}

export interface DeleteBackupDialogProps {
  target: BackupRun | null;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** "Delete this backup?" confirmation for a run's archive. */
export function DeleteBackupDialog({ target, deleting, onCancel, onConfirm }: DeleteBackupDialogProps) {
  return (
    <Dialog open={!!target} onClose={() => !deleting && onCancel()}>
      <DialogTitle>Delete this backup?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          The backup from {formatDateTime(target?.startedAt) ?? 'this run'} will be removed from
          storage. This cannot be undone. The entry stays in the history.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={deleting}>
          Cancel
        </Button>
        <Button
          color="error"
          variant="contained"
          onClick={onConfirm}
          disabled={deleting}
          startIcon={deleting ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  );
}
