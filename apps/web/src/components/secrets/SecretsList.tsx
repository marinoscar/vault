import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  TextField,
  Button,
  MenuItem,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TablePagination,
  Chip,
  IconButton,
  Typography,
  CircularProgress,
  Tooltip,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { SecretTypeIcon } from './SecretTypeIcon';
import type { SecretListItem, SecretType } from '../../types';

interface SecretsListProps {
  secrets: SecretListItem[];
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
  isLoading: boolean;
  secretTypes: SecretType[];
  onFetch: (params: {
    page?: number;
    pageSize?: number;
    typeId?: string;
    search?: string;
  }) => void;
  onRowClick: (id: string) => void;
  onCreateClick: () => void;
  onDeleteClick?: (id: string) => void;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 30) return date.toLocaleDateString();
  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  if (diffMinutes > 0) return `${diffMinutes}m ago`;
  return 'just now';
}

export function SecretsList({
  secrets,
  totalItems,
  page,
  pageSize,
  isLoading,
  secretTypes,
  onFetch,
  onRowClick,
  onCreateClick,
  onDeleteClick,
}: SecretsListProps) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  // Convert 1-based API page to 0-based MUI page
  const currentPage = page - 1;

  const doFetch = useCallback(
    (params: { page?: number; pageSize?: number; typeId?: string; search?: string }) => {
      onFetch(params);
    },
    [onFetch],
  );

  // Trigger fetch on filter change
  useEffect(() => {
    doFetch({
      page: 1,
      pageSize,
      typeId: typeFilter || undefined,
      search: search || undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, typeFilter]);

  const handlePageChange = (_: unknown, newPage: number) => {
    doFetch({
      page: newPage + 1,
      pageSize,
      typeId: typeFilter || undefined,
      search: search || undefined,
    });
  };

  const handleRowsPerPageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    doFetch({
      page: 1,
      pageSize: parseInt(e.target.value, 10),
      typeId: typeFilter || undefined,
      search: search || undefined,
    });
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
  };

  const handleTypeFilterChange = (value: string) => {
    setTypeFilter(value);
  };

  return (
    <Box>
      {/* Top bar */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <TextField
          label="Search secrets"
          size="small"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          sx={{ flexGrow: 1, minWidth: 200 }}
        />
        <TextField
          select
          label="Type"
          size="small"
          value={typeFilter}
          onChange={(e) => handleTypeFilterChange(e.target.value)}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">All types</MenuItem>
          {secretTypes.map((type) => (
            <MenuItem key={type.id} value={type.id}>
              {type.name}
            </MenuItem>
          ))}
        </TextField>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={onCreateClick}
        >
          New Secret
        </Button>
      </Box>

      {/* Table */}
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : secrets.length === 0 ? (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Typography color="text.secondary">
            {search || typeFilter
              ? 'No secrets match your filters'
              : 'No secrets yet. Create one to get started.'}
          </Typography>
        </Box>
      ) : (
        <>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Version</TableCell>
                  <TableCell>Updated</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {secrets.map((secret) => (
                  <TableRow
                    key={secret.id}
                    hover
                    onClick={() => onRowClick(secret.id)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell>
                      <Box>
                        <Typography variant="body2" fontWeight={500}>
                          {secret.name}
                        </Typography>
                        {secret.description && (
                          <Typography variant="caption" color="text.secondary">
                            {secret.description}
                          </Typography>
                        )}
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip
                        icon={<SecretTypeIcon icon={secret.type.icon} fontSize="small" />}
                        label={secret.type.name}
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">v{secret.currentVersion}</Typography>
                    </TableCell>
                    <TableCell>
                      <Tooltip title={new Date(secret.updatedAt).toLocaleString()}>
                        <Typography variant="body2">
                          {formatRelativeTime(secret.updatedAt)}
                        </Typography>
                      </Tooltip>
                    </TableCell>
                    <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                      {onDeleteClick && (
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => onDeleteClick(secret.id)}
                          aria-label="Delete secret"
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      )}
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
