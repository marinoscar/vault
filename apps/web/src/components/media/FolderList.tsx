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
  Folder as FolderIcon,
} from '@mui/icons-material';
import type { MediaFolder } from '../../types';

interface FolderListProps {
  folders: MediaFolder[];
  totalItems: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  onFetch: (params?: { page?: number; pageSize?: number; search?: string }) => void;
  onRowClick: (folderId: string) => void;
  onCreateClick: () => void;
  onEditClick: (folderId: string) => void;
  onDeleteClick: (folder: MediaFolder) => void;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString();
}

export function FolderList({
  folders,
  totalItems,
  page,
  pageSize,
  isLoading,
  onFetch,
  onRowClick,
  onCreateClick,
  onEditClick,
  onDeleteClick,
}: FolderListProps) {
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
          label="Search folders"
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ flexGrow: 1, minWidth: 200 }}
        />
        <Button variant="contained" startIcon={<AddIcon />} onClick={onCreateClick}>
          New Folder
        </Button>
      </Box>

      {/* Table */}
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : folders.length === 0 ? (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Typography color="text.secondary">
            {search
              ? 'No folders match your search'
              : 'No folders yet. Create one to get started.'}
          </Typography>
        </Box>
      ) : (
        <>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Files</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {folders.map((folder) => (
                  <TableRow
                    key={folder.id}
                    hover
                    onClick={() => onRowClick(folder.id)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <FolderIcon fontSize="small" color="action" />
                        <Typography variant="body2" fontWeight={500}>
                          {folder.name}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{folder.fileCount}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{formatDate(folder.createdAt)}</Typography>
                    </TableCell>
                    <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                      <Tooltip title="Rename">
                        <IconButton
                          size="small"
                          onClick={() => onEditClick(folder.id)}
                          aria-label="Rename folder"
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => onDeleteClick(folder)}
                          aria-label="Delete folder"
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
