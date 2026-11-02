import { useState, useEffect } from 'react';
import { breakableEmail } from '../../utils/breakableEmail';
import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TextField,
  Button,
  IconButton,
  Chip,
  Box,
  Typography,
  Tooltip,
  CircularProgress,
  Alert,
} from '@mui/material';
import { Delete as DeleteIcon, Add as AddIcon } from '@mui/icons-material';
import { useAllowlist } from '../../hooks/useAllowlist';
import { AddEmailDialog } from './AddEmailDialog';
import type { AllowedEmailEntry } from '../../types';

/**
 * Columns dropped below 900px so the table fits a phone without a sideways
 * scroll (email, status and the remove action stay). Content adaptation
 * through `sx`, not a breakpoint gate.
 */
const WIDE_ONLY = { display: { xs: 'none', md: 'table-cell' } } as const;

export function AllowlistTable() {
  const {
    entries,
    total,
    isLoading,
    error,
    fetchAllowlist,
    addEmail,
    removeEmail,
  } = useAllowlist();

  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  // Fetch data on mount and when pagination changes
  useEffect(() => {
    fetchAllowlist({
      page: currentPage + 1,
      pageSize: rowsPerPage,
      search: search || undefined,
    });
  }, [currentPage, rowsPerPage, search, fetchAllowlist]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setCurrentPage(0); // Reset to first page on search
  };

  const handleChangePage = (_: unknown, newPage: number) => {
    setCurrentPage(newPage);
  };

  const handleChangeRowsPerPage = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setCurrentPage(0);
  };

  const handleRemove = async (id: string) => {
    if (window.confirm('Are you sure you want to remove this email from the allowlist?')) {
      try {
        await removeEmail(id);
      } catch (err) {
        // Error is handled by the hook
      }
    }
  };

  const handleAddEmail = async (email: string, notes?: string) => {
    await addEmail(email, notes);
  };

  const getStatusChip = (entry: AllowedEmailEntry) => {
    if (entry.claimedBy) {
      return <Chip label="Claimed" color="success" size="small" />;
    }
    return <Chip label="Pending" color="warning" size="small" />;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  return (
    <Paper sx={{ width: '100%', overflow: 'hidden' }}>
      <Box sx={{ p: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
        <TextField
          label="Search by email"
          variant="outlined"
          size="small"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          sx={{ flexGrow: 1 }}
        />
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setDialogOpen(true)}
        >
          Add Email
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mx: 2, mb: 2 }}>
          {error}
        </Alert>
      )}

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      ) : entries.length === 0 ? (
        <Box sx={{ p: 4, textAlign: 'center' }}>
          <Typography sx={{
            color: "text.secondary"
          }}>
            {search ? 'No emails found matching your search' : 'No emails in allowlist'}
          </Typography>
        </Box>
      ) : (
        <>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Email</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell sx={WIDE_ONLY}>Added By</TableCell>
                  <TableCell sx={WIDE_ONLY}>Added Date</TableCell>
                  <TableCell sx={WIDE_ONLY}>Notes</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id} hover>
                    <TableCell sx={{ overflowWrap: 'break-word' }}>{breakableEmail(entry.email)}</TableCell>
                    <TableCell>{getStatusChip(entry)}</TableCell>
                    <TableCell sx={WIDE_ONLY}>
                      {entry.addedBy ? entry.addedBy.email : 'System'}
                    </TableCell>
                    <TableCell sx={WIDE_ONLY}>{formatDate(entry.addedAt)}</TableCell>
                    <TableCell sx={WIDE_ONLY}>
                      {entry.notes ? (
                        <Typography variant="body2" sx={{ maxWidth: 200 }}>
                          {entry.notes}
                        </Typography>
                      ) : (
                        <Typography variant="body2" sx={{
                          color: "text.secondary"
                        }}>
                          -
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {entry.claimedBy ? (
                        <Tooltip title="Cannot remove claimed emails">
                          <span>
                            <IconButton size="small" disabled>
                              <DeleteIcon />
                            </IconButton>
                          </span>
                        </Tooltip>
                      ) : (
                        <IconButton
                          size="small"
                          onClick={() => handleRemove(entry.id)}
                          color="error"
                        >
                          <DeleteIcon />
                        </IconButton>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={total}
            page={currentPage}
            onPageChange={handleChangePage}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={handleChangeRowsPerPage}
            rowsPerPageOptions={[5, 10, 25, 50]}
          />
        </>
      )}

      <AddEmailDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onAdd={handleAddEmail}
      />
    </Paper>
  );
}
