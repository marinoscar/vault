import {
  Box,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  IconButton,
  Button,
  Typography,
  Chip,
  CircularProgress,
  Tooltip,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Check as CheckIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { SecretTypeIcon } from '../secrets/SecretTypeIcon';
import type { SecretType } from '../../types';

interface SecretTypesListProps {
  types: SecretType[];
  isLoading: boolean;
  onCreateClick: () => void;
  onEditClick: (type: SecretType) => void;
  onDeleteClick: (type: SecretType) => void;
}

export function SecretTypesList({
  types,
  isLoading,
  onCreateClick,
  onEditClick,
  onDeleteClick,
}: SecretTypesListProps) {
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={onCreateClick}>
          New Type
        </Button>
      </Box>

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : types.length === 0 ? (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Typography color="text.secondary">No secret types defined yet.</Typography>
        </Box>
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Icon</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Fields</TableCell>
                <TableCell>Attachments</TableCell>
                <TableCell>System</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {types.map((type) => (
                <TableRow key={type.id} hover>
                  <TableCell>
                    <SecretTypeIcon icon={type.icon} fontSize="small" color="action" />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>
                      {type.name}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {type.description ?? '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{type.fields.length}</Typography>
                  </TableCell>
                  <TableCell>
                    {type.allowAttachments ? (
                      <CheckIcon fontSize="small" color="success" />
                    ) : (
                      <CloseIcon fontSize="small" color="disabled" />
                    )}
                  </TableCell>
                  <TableCell>
                    {type.isSystem && (
                      <Chip label="System" size="small" color="primary" variant="outlined" />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {type.isSystem ? (
                      <Tooltip title="System types cannot be modified">
                        <span>
                          <IconButton size="small" disabled>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    ) : (
                      <>
                        <IconButton
                          size="small"
                          onClick={() => onEditClick(type)}
                          aria-label="Edit type"
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => onDeleteClick(type)}
                          aria-label="Delete type"
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
    </Box>
  );
}
