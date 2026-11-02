import { useEffect, useId, useState, type ReactElement } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Switch,
  Typography,
} from '@mui/material';
import {
  AddCircleOutlineOutlined as AddedIcon,
  ArrowBack as BackIcon,
  ChevronRight as ChevronIcon,
  Close as CloseIcon,
  EditOutlined as ChangedIcon,
  History as HistoryIcon,
  RemoveCircleOutlineOutlined as RemovedIcon,
  Restore as RestoreIcon,
  DragHandle as SameIcon,
} from '@mui/icons-material';
import { CardImages, supportsCardImages } from './CardImages.js';
import { MASK } from './SecretValueField.js';
import { diffSecretValues, type FieldChange } from '../../headless/secretFields.js';
import type { SecretVersionDetailWithAttachments } from '../../headless/useSecretDetail.js';
import type { SecretDetail, SecretVersion } from '../../../core/headless/types.js';

interface SecretVersionDrawerProps {
  open: boolean;
  onClose: () => void;
  /** The current secret: its values are the right-hand side of every diff. */
  secret: SecretDetail;
  versions: SecretVersion[];
  loadVersion: (versionId: string) => Promise<SecretVersionDetailWithAttachments>;
  /** Rolls back (a new current version is created); absent without `secrets:write`. */
  onRollback?: (versionId: string) => Promise<void>;
}

/**
 * Each change has a glyph and a word; the hue is on the glyph only, so the
 * label keeps body-text contrast (status is never colour alone).
 */
const CHANGE_META: Record<FieldChange, { label: string; icon: ReactElement; tone: string }> = {
  changed: { label: 'Changed', icon: <ChangedIcon />, tone: 'warning.main' },
  added: { label: 'Added', icon: <AddedIcon />, tone: 'success.main' },
  removed: { label: 'Removed', icon: <RemovedIcon />, tone: 'error.main' },
  unchanged: { label: 'Same', icon: <SameIcon />, tone: 'text.secondary' },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function ValueBox({ label, value, sensitive, showValues }: {
  label: string;
  value: string;
  sensitive: boolean;
  showValues: boolean;
}) {
  return (
    <Box sx={{ flex: '1 1 180px', minWidth: 0 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          fontFamily: sensitive ? 'monospace' : undefined,
          overflowWrap: 'anywhere',
          whiteSpace: 'pre-wrap',
          color: value === '' ? 'text.disabled' : 'text.primary',
        }}
      >
        {value === '' ? '—' : sensitive && !showValues ? MASK : value}
      </Typography>
    </Box>
  );
}

/**
 * Version history in a side drawer (full width on a phone): the list of
 * versions, and for one historical version a field-by-field comparison with
 * the current values plus that version's own card photos. Sensitive values
 * stay masked unless "Show values" is on, and that switch resets whenever the
 * drawer closes. Restoring a version calls the rollback endpoint, which
 * creates a new current version; history itself is immutable.
 */
export function SecretVersionDrawer({
  open,
  onClose,
  secret,
  versions,
  loadVersion,
  onRollback,
}: SecretVersionDrawerProps) {
  const titleId = useId();
  const [selected, setSelected] = useState<SecretVersion | null>(null);
  const [detail, setDetail] = useState<SecretVersionDetailWithAttachments | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showValues, setShowValues] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // Closing forgets everything: the next open starts at the list, masked.
  useEffect(() => {
    if (!open) {
      setSelected(null);
      setDetail(null);
      setError(null);
      setShowValues(false);
      setConfirming(false);
    }
  }, [open]);

  useEffect(() => {
    if (!selected) return undefined;
    let current = true;
    setLoading(true);
    setError(null);
    setDetail(null);
    loadVersion(selected.id)
      .then((d) => current && setDetail(d))
      .catch((err: unknown) => {
        if (current) setError(err instanceof Error ? err.message : 'Failed to load version');
      })
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [selected, loadVersion]);

  const fields = secret.type?.fields ?? [];
  const diffs = detail ? diffSecretValues(fields, detail.values ?? {}, secret.values ?? {}) : [];
  const differing = diffs.filter((d) => d.change !== 'unchanged').length;
  const hasSensitive = fields.some((f) => f.sensitive);

  const restore = async () => {
    if (!selected || !onRollback) return;
    setRestoring(true);
    try {
      await onRollback(selected.id);
      setConfirming(false);
      setSelected(null);
    } catch (err) {
      setConfirming(false);
      setError(err instanceof Error ? err.message : 'Failed to restore version');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-modal': true,
          'aria-labelledby': titleId,
          sx: { width: { xs: '100%', sm: 520 }, maxWidth: '100%', display: 'flex' },
        } as object,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2,
          py: 1.5,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        {selected ? (
          <IconButton onClick={() => setSelected(null)} aria-label="Back to all versions" edge="start">
            <BackIcon />
          </IconButton>
        ) : (
          <HistoryIcon sx={{ color: 'text.secondary', ml: 0.5 }} />
        )}
        <Typography id={titleId} variant="h6" component="h2" sx={{ flexGrow: 1, minWidth: 0 }}>
          {selected ? `Version ${selected.version}` : 'Version history'}
        </Typography>
        <IconButton onClick={onClose} aria-label="Close version history" edge="end">
          <CloseIcon />
        </IconButton>
      </Box>

      <Box sx={{ flexGrow: 1, overflowY: 'auto', minHeight: 0 }}>
        {!selected && (
          <>
            {versions.length === 0 ? (
              <Typography variant="body2" sx={{ color: 'text.secondary', p: 3 }}>
                No version history available.
              </Typography>
            ) : (
              <List disablePadding aria-label="Versions">
                {versions.map((version) => {
                  const text = (
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography component="span" sx={{ fontWeight: 600 }}>
                            v{version.version}
                          </Typography>
                          {version.isCurrent && (
                            <Chip label="Current" size="small" color="primary" variant="outlined" />
                          )}
                        </Box>
                      }
                      secondary={`${formatDate(version.createdAt)}${
                        version.createdBy ? ` · ${version.createdBy.email}` : ''
                      }`}
                    />
                  );
                  return version.isCurrent ? (
                    <ListItem key={version.id} divider sx={{ px: 2, py: 1.25 }}>
                      {text}
                    </ListItem>
                  ) : (
                    <ListItemButton
                      key={version.id}
                      divider
                      onClick={() => setSelected(version)}
                      aria-label={`Compare version ${version.version} with current`}
                      sx={{ px: 2, py: 1.25 }}
                    >
                      {text}
                      <ChevronIcon sx={{ color: 'text.secondary' }} />
                    </ListItemButton>
                  );
                })}
              </List>
            )}
          </>
        )}

        {selected && (
          <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {error && <Alert severity="error">{error}</Alert>}
            {loading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress aria-label="Loading version" />
              </Box>
            )}
            {detail && (
              <>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Created {formatDate(detail.createdAt)}
                  {detail.createdBy && ` by ${detail.createdBy.email}`}
                </Typography>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 1,
                  }}
                >
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                    {differing === 0
                      ? `Same values as the current version (v${secret.currentVersion})`
                      : `${differing} ${differing === 1 ? 'field differs' : 'fields differ'} from the current version (v${secret.currentVersion})`}
                  </Typography>
                  {hasSensitive && (
                    <FormControlLabel
                      control={
                        <Switch
                          checked={showValues}
                          onChange={(e) => setShowValues(e.target.checked)}
                          size="small"
                        />
                      }
                      label="Show values"
                    />
                  )}
                </Box>

                <Box
                  component="ul"
                  aria-label="Field comparison"
                  sx={{ listStyle: 'none', m: 0, p: 0, border: 1, borderColor: 'divider', borderRadius: 2 }}
                >
                  {diffs.map((d, index) => {
                    const meta = CHANGE_META[d.change];
                    return (
                      <Box
                        component="li"
                        key={d.field.name}
                        data-testid={`diff-${d.field.name}`}
                        data-change={d.change}
                        sx={{
                          px: 2,
                          py: 1.5,
                          borderTop: index === 0 ? 0 : 1,
                          borderColor: 'divider',
                          opacity: d.change === 'unchanged' ? 0.75 : 1,
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600, flexGrow: 1 }}>
                            {d.field.label}
                          </Typography>
                          <Chip
                            size="small"
                            icon={meta.icon}
                            label={meta.label}
                            variant="outlined"
                            sx={{ '& .MuiChip-icon': { color: meta.tone } }}
                          />
                        </Box>
                        {d.change === 'unchanged' ? (
                          <ValueBox
                            label="Both"
                            value={d.version}
                            sensitive={d.field.sensitive}
                            showValues={showValues}
                          />
                        ) : (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                            <ValueBox
                              label={`v${detail.version}`}
                              value={d.version}
                              sensitive={d.field.sensitive}
                              showValues={showValues}
                            />
                            <ValueBox
                              label={`Current (v${secret.currentVersion})`}
                              value={d.current}
                              sensitive={d.field.sensitive}
                              showValues={showValues}
                            />
                          </Box>
                        )}
                      </Box>
                    );
                  })}
                </Box>

                {/* Deliberately the version's OWN attachments: viewing v1 of a
                    renewed card shows v1's photo. Read-only: history is immutable. */}
                {supportsCardImages(secret.type, detail.attachments ?? []) && (
                  <>
                    <Divider />
                    <CardImages
                      secretId={secret.id}
                      attachments={detail.attachments ?? []}
                      readOnly
                      title={`Card Images (v${detail.version})`}
                    />
                  </>
                )}
              </>
            )}
          </Box>
        )}
      </Box>

      {selected && detail && onRollback && (
        <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
          <Button
            fullWidth
            variant="contained"
            startIcon={<RestoreIcon />}
            onClick={() => setConfirming(true)}
          >
            Restore version {selected.version}
          </Button>
        </Box>
      )}

      <Dialog open={confirming} onClose={() => !restoring && setConfirming(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Restore version {selected?.version}?</DialogTitle>
        <DialogContent>
          <Typography>
            This creates version {secret.currentVersion + 1} with the values of v{selected?.version}.
            The current values stay in the history.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)} disabled={restoring}>
            Cancel
          </Button>
          <Button variant="contained" onClick={() => void restore()} disabled={restoring}>
            Restore
          </Button>
        </DialogActions>
      </Dialog>
    </Drawer>
  );
}
