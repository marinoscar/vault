import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  TextField,
  Button,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TablePagination,
  IconButton,
  Typography,
  CircularProgress,
  Tooltip,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  PlayArrow as PlayArrowIcon,
  Download as DownloadIcon,
  VideoFile as VideoFileIcon,
  AudioFile as AudioFileIcon,
  Image as ImageIcon,
} from '@mui/icons-material';
import type { MediaFile } from '../../types';

interface MediaListProps {
  files: MediaFile[];
  totalItems: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  onFetch: (params?: { page?: number; pageSize?: number; search?: string }) => void;
  onViewClick: (fileId: string) => void;
  onDownloadClick: (fileId: string) => void;
  onRenameClick: (fileId: string) => void;
  onDeleteClick: (file: MediaFile) => void;
  onUploadClick: () => void;
}

function getMediaTypeIcon(mimeType: string) {
  if (mimeType.startsWith('video/')) return <VideoFileIcon fontSize="small" color="action" />;
  if (mimeType.startsWith('audio/')) return <AudioFileIcon fontSize="small" color="action" />;
  return <ImageIcon fontSize="small" color="action" />;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getLastAccessed(file: MediaFile): string {
  const lastAccessed = file.metadata?.lastAccessedAt;
  if (!lastAccessed || typeof lastAccessed !== 'string') return 'Never';
  return new Date(lastAccessed).toLocaleDateString();
}

export function MediaList({
  files,
  totalItems,
  page,
  pageSize,
  isLoading,
  onFetch,
  onViewClick,
  onDownloadClick,
  onRenameClick,
  onDeleteClick,
  onUploadClick,
}: MediaListProps) {
  const [search, setSearch] = useState('');

  // Convert 1-based API page to 0-based MUI page
  const currentPage = page - 1;

  const doFetch = useCallback(
    (params?: { page?: number; pageSize?: number; search?: string }) => {
      onFetch(params);
    },
    [onFetch],
  );

  useEffect(() => {
    doFetch({ page: 1, pageSize, search: search || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handlePageChange = (_: unknown, newPage: number) => {
    doFetch({ page: newPage + 1, pageSize, search: search || undefined });
  };

  const handleRowsPerPageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    doFetch({
      page: 1,
      pageSize: parseInt(e.target.value, 10),
      search: search || undefined,
    });
  };

  return (
    <Box>
      {/* Top bar */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <TextField
          label="Search files"
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ flexGrow: 1, minWidth: 200 }}
        />
        <Button variant="contained" startIcon={<AddIcon />} onClick={onUploadClick}>
          Upload
        </Button>
      </Box>

      {/* Table */}
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : files.length === 0 ? (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Typography color="text.secondary">
            {search
              ? 'No files match your search'
              : 'No files yet. Upload one to get started.'}
          </Typography>
        </Box>
      ) : (
        <>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Last Accessed</TableCell>
                  <TableCell>Size</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {files.map((file) => (
                  <TableRow key={file.id} hover>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {getMediaTypeIcon(file.mimeType)}
                        <Typography variant="body2" fontWeight={500}>
                          {file.name}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{getLastAccessed(file)}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{formatFileSize(file.size)}</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="View">
                        <IconButton
                          size="small"
                          onClick={() => onViewClick(file.id)}
                          aria-label="View file"
                        >
                          <PlayArrowIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Download">
                        <IconButton
                          size="small"
                          onClick={() => onDownloadClick(file.id)}
                          aria-label="Download file"
                        >
                          <DownloadIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Rename">
                        <IconButton
                          size="small"
                          onClick={() => onRenameClick(file.id)}
                          aria-label="Rename file"
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => onDeleteClick(file)}
                          aria-label="Delete file"
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
          <TablePagination
            component="div"
            count={totalItems}
            page={currentPage}
            onPageChange={handlePageChange}
            rowsPerPage={pageSize}
            onRowsPerPageChange={handleRowsPerPageChange}
            rowsPerPageOptions={[10, 25, 50]}
          />
        </>
      )}
    </Box>
  );
}
