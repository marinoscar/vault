import { useState, type FormEvent, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Divider,
  Link,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { DynamicSecretFields } from './DynamicSecretFields';
import { SecretTypeIcon } from './SecretTypeIcon';
import {
  SECRET_DESCRIPTION_MAX,
  SECRET_NAME_MAX,
  cleanSecretData,
  isCardType,
  validateSecretForm,
  type SecretFormErrors,
} from '../../utils/secretFields';
import type { SecretType } from '../../types';

export interface SecretFormValues {
  name: string;
  description: string;
  typeId: string;
  /** Only the fields the type declares, with empty optional ones dropped. */
  data: Record<string, unknown>;
}

interface SecretFormProps {
  mode: 'create' | 'edit';
  /** Create: every selectable type. Edit: the secret's own type only. */
  types: SecretType[];
  initial?: { name: string; description: string; typeId: string; data: Record<string, unknown> };
  submitLabel: string;
  submittingLabel: string;
  /** Resolve to finish; reject (an Error) to show its message on the form. */
  onSubmit: (values: SecretFormValues) => Promise<void>;
  onCancel: () => void;
  header?: ReactNode;
}

const NO_ERRORS: SecretFormErrors = { fields: {} };

/**
 * The create/edit form: name, description, type (create only; a secret's type
 * never changes) and the type's own fields, validated with the same rules the
 * API applies before anything is sent. Picking the Card type points to the
 * Cards scan flow, which also captures the card photos.
 */
export function SecretForm({
  mode,
  types,
  initial,
  submitLabel,
  submittingLabel,
  onSubmit,
  onCancel,
  header,
}: SecretFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [typeId, setTypeId] = useState(initial?.typeId ?? '');
  const [data, setData] = useState<Record<string, unknown>>(initial?.data ?? {});
  const [errors, setErrors] = useState<SecretFormErrors>(NO_ERRORS);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const type = types.find((t) => t.id === typeId) ?? null;
  const fields = type?.fields ?? [];

  const changeType = (next: string) => {
    setTypeId(next);
    setData({});
    setErrors((e) => ({ ...e, typeId: undefined, fields: {} }));
  };

  const changeData = (next: Record<string, unknown>) => {
    setData(next);
    // Clear a field's error as soon as it is edited; re-validated on submit.
    setErrors((e) => {
      const remaining = Object.fromEntries(
        Object.entries(e.fields).filter(([key]) => next[key] === data[key]),
      );
      return { ...e, fields: remaining };
    });
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const result = validateSecretForm({
      name,
      description,
      typeId,
      requireType: mode === 'create',
      fields,
      data,
    });
    setErrors(result.errors);
    if (result.hasErrors) {
      setFormError('Fix the highlighted fields and try again.');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        typeId,
        data: cleanSecretData(fields, data),
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save secret');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, p: { xs: 2, sm: 3 } }}>
      {header}
      <Box
        component="form"
        noValidate
        onSubmit={handleSubmit}
        sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}
      >
        {formError && <Alert severity="error">{formError}</Alert>}

        {mode === 'create' && (
          <TextField
            select
            label="Type"
            fullWidth
            required
            value={typeId}
            onChange={(e) => changeType(e.target.value)}
            disabled={submitting}
            error={Boolean(errors.typeId)}
            helperText={errors.typeId ?? type?.description ?? 'What kind of secret is this?'}
          >
            {types.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <SecretTypeIcon icon={t.icon} fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={t.name} />
              </MenuItem>
            ))}
          </TextField>
        )}

        {mode === 'create' && isCardType(type) && (
          <Alert severity="info" variant="outlined">
            Have the card at hand?{' '}
            <Link component={RouterLink} to="/cards/import">
              Scan it in Cards
            </Link>{' '}
            to fill these fields from photos and keep the photos with the card.
          </Alert>
        )}

        <TextField
          label="Name"
          fullWidth
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setErrors((er) => ({ ...er, name: undefined }));
          }}
          disabled={submitting}
          autoFocus={mode === 'edit'}
          error={Boolean(errors.name)}
          helperText={errors.name}
          slotProps={{ htmlInput: { maxLength: SECRET_NAME_MAX } }}
        />

        <TextField
          label="Description"
          fullWidth
          multiline
          minRows={2}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setErrors((er) => ({ ...er, description: undefined }));
          }}
          disabled={submitting}
          error={Boolean(errors.description)}
          helperText={errors.description ?? 'Optional. Not encrypted; do not put secret values here.'}
          slotProps={{ htmlInput: { maxLength: SECRET_DESCRIPTION_MAX } }}
        />

        {fields.length > 0 && (
          <>
            <Divider textAlign="left">
              <Typography variant="overline" sx={{ color: 'text.secondary' }}>
                {type?.name} fields
              </Typography>
            </Divider>
            <DynamicSecretFields
              fields={fields}
              data={data}
              onChange={changeData}
              errors={errors.fields}
            />
          </>
        )}

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap', mt: 1 }}>
          <Button onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={submitting}>
            {submitting ? submittingLabel : submitLabel}
          </Button>
        </Box>
      </Box>
    </Paper>
  );
}
