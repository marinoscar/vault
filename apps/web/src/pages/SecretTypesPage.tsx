import { useEffect, useState, useCallback } from 'react';
import { Container, Typography, Alert, Snackbar } from '@mui/material';
import { SecretTypesList } from '../components/secret-types/SecretTypesList';
import { SecretTypeFormDialog } from '../components/secret-types/SecretTypeFormDialog';
import { useSecretTypes } from '../hooks/useSecretTypes';
import type { SecretType, FieldDefinition } from '../types';

export default function SecretTypesPage() {
  const { types, isLoading, error, fetchTypes, createType, updateType, deleteType } =
    useSecretTypes();
  const [formOpen, setFormOpen] = useState(false);
  const [editType, setEditType] = useState<SecretType | undefined>();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchTypes();
  }, [fetchTypes]);

  const handleCreate = useCallback(
    async (data: {
      name: string;
      description?: string;
      icon?: string;
      fields: FieldDefinition[];
      allowAttachments: boolean;
    }) => {
      await createType(data);
      setFormOpen(false);
      setSuccessMessage('Secret type created');
    },
    [createType],
  );

  const handleEdit = useCallback((type: SecretType) => {
    setEditType(type);
    setFormOpen(true);
  }, []);

  const handleUpdate = useCallback(
    async (data: {
      name: string;
      description?: string;
      icon?: string;
      fields: FieldDefinition[];
      allowAttachments: boolean;
    }) => {
      if (!editType) return;
      await updateType(editType.id, data);
      setFormOpen(false);
      setEditType(undefined);
      setSuccessMessage('Secret type updated');
    },
    [editType, updateType],
  );

  const handleDelete = useCallback(
    async (type: SecretType) => {
      if (confirm(`Delete "${type.name}"? This cannot be undone.`)) {
        await deleteType(type.id);
        setSuccessMessage('Secret type deleted');
      }
    },
    [deleteType],
  );

  const handleClose = useCallback(() => {
    setFormOpen(false);
    setEditType(undefined);
  }, []);

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Typography variant="h4" gutterBottom>
        Secret Types
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <SecretTypesList
        types={types}
        isLoading={isLoading}
        onCreateClick={() => {
          setEditType(undefined);
          setFormOpen(true);
        }}
        onEditClick={handleEdit}
        onDeleteClick={handleDelete}
      />

      <SecretTypeFormDialog
        open={formOpen}
        onClose={handleClose}
        onSave={editType ? handleUpdate : handleCreate}
        editType={editType}
      />

      <Snackbar
        open={!!successMessage}
        autoHideDuration={3000}
        onClose={() => setSuccessMessage(null)}
      >
        <Alert severity="success">{successMessage}</Alert>
      </Snackbar>
    </Container>
  );
}
