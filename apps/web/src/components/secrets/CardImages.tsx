import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import {
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Upload as UploadIcon,
  Delete as DeleteIcon,
  CreditCard as CreditCardIcon,
} from '@mui/icons-material';
import {
  getStorageObjectDownloadUrl,
  linkSecretAttachment,
  simpleStorageUpload,
  unlinkSecretAttachment,
} from '../../services/api';
import { CARD_TYPE_NAME } from '../../hooks/useCards';
import type { AttachmentRole, SecretAttachment, SecretType } from '../../types';

/**
 * Mirror of the API's card image allowlist (`CARD_IMAGE_MIME_TYPES` in
 * secrets.service.ts). Checked client-side purely so an obviously-wrong file is
 * rejected before it is uploaded; the API remains the authority.
 */
const ACCEPTED_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

/** Mirror of the API's `DEFAULT_CARD_IMAGE_MAX_BYTES`. */
const MAX_CARD_IMAGE_BYTES = 5 * 1024 * 1024;

const SLOTS: ReadonlyArray<{ role: AttachmentRole; label: string }> = [
  { role: 'card_front', label: 'Front' },
  { role: 'card_back', label: 'Back' },
];

/**
 * Strip parameters and casing from a mime type so `image/jpeg; charset=binary`
 * compares equal to `image/jpeg`, matching the API's normalisation.
 */
function normalizeMimeType(mimeType: string): string {
  return (mimeType ?? '').split(';')[0].trim().toLowerCase();
}

/**
 * Whether a secret should offer card front/back image slots.
 *
 * Attachments are the gate: a type that forbids them can never hold a card
 * face. Beyond that, the system Card type always gets slots (so a brand new
 * card offers somewhere to put its photos), and any other type gets them only
 * once it actually holds a role-bearing attachment — which keeps a Document,
 * whose attachments are all role-less, completely unaffected.
 */
export function supportsCardImages(
  type: SecretType | null | undefined,
  attachments: SecretAttachment[] = [],
): boolean {
  const hasRoleAttachment = attachments.some((a) => a.role !== null);
  if (!type) {
    return hasRoleAttachment;
  }
  if (!type.allowAttachments) {
    return false;
  }
  if (type.isSystem && type.name === CARD_TYPE_NAME) {
    return true;
  }
  return hasRoleAttachment;
}

/** Pick the single attachment holding a given card role, if any. */
export function findCardImage(
  attachments: SecretAttachment[],
  role: AttachmentRole,
): SecretAttachment | undefined {
  return attachments.find((a) => a.role === role);
}

type ImageStatus = 'idle' | 'loading' | 'ready' | 'error';

interface CardImageSlotProps {
  secretId: string;
  role: AttachmentRole;
  label: string;
  attachment: SecretAttachment | undefined;
  readOnly: boolean;
  onChange: () => void;
}

function CardImageSlot({
  secretId,
  role,
  label,
  attachment,
  readOnly,
  onChange,
}: CardImageSlotProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [revealed, setRevealed] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<ImageStatus>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const attachmentId = attachment?.id ?? null;
  const objectId = attachment?.storageObject.id;

  // Re-conceal and drop the signed URL whenever the slot changes what it points
  // at — replacing an image, or switching to a different version's photo. A
  // stale URL here would render the previous card face.
  useEffect(() => {
    setRevealed(false);
    setUrl(null);
    setStatus('idle');
    setLoadError(null);
  }, [attachmentId]);

  const loadUrl = useCallback(async () => {
    if (!objectId) return;
    setStatus('loading');
    setLoadError(null);
    try {
      const result = await getStorageObjectDownloadUrl(objectId);
      if (!result?.url) {
        throw new Error('No download URL was returned for this image.');
      }
      setUrl(result.url);
      setStatus('ready');
    } catch (err) {
      setUrl(null);
      setStatus('error');
      setLoadError(err instanceof Error ? err.message : 'Failed to load image');
    }
  }, [objectId]);

  /**
   * The signed URL is fetched here rather than on mount: nothing about the card
   * face leaves the API until the user asks to see it, and the short-lived URL
   * is minted at the moment it is actually used.
   */
  const handleReveal = useCallback(() => {
    setRevealed(true);
    if (!url) {
      void loadUrl();
    }
  }, [url, loadUrl]);

  const handleHide = useCallback(() => {
    setRevealed(false);
  }, []);

  const handleImageError = useCallback(() => {
    setStatus('error');
    setLoadError('This image could not be displayed. The file may be missing.');
  }, []);

  const handleUploadClick = useCallback(() => {
    setActionError(null);
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset so re-picking the same file still fires a change event.
      e.target.value = '';
      if (!file) return;

      if (!ACCEPTED_MIME_TYPES.includes(normalizeMimeType(file.type))) {
        setActionError('Card images must be a JPEG, PNG, WebP, or HEIC image.');
        return;
      }
      if (file.size > MAX_CARD_IMAGE_BYTES) {
        setActionError('Card images must be 5 MB or smaller.');
        return;
      }

      setBusy(true);
      setActionError(null);
      try {
        // Upload before unlinking: a failed upload must not cost the user the
        // image they already had.
        const object = await simpleStorageUpload(file);
        if (attachmentId) {
          // The API enforces one attachment per role per version, so a replace
          // has to free the role before the new object can claim it.
          await unlinkSecretAttachment(secretId, attachmentId);
        }
        await linkSecretAttachment(secretId, object.id, file.name, role);
        onChange();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setBusy(false);
      }
    },
    [secretId, attachmentId, role, onChange],
  );

  const handleRemove = useCallback(async () => {
    if (!attachmentId) return;
    setBusy(true);
    setActionError(null);
    try {
      await unlinkSecretAttachment(secretId, attachmentId);
      onChange();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to remove image');
    } finally {
      setBusy(false);
    }
  }, [secretId, attachmentId, onChange]);

  const hasImage = Boolean(attachment);

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}
    >
      <Typography variant="subtitle2" component="h4">
        {label}
      </Typography>

      <Box
        sx={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 1,
          minHeight: 160,
          borderRadius: 1,
          p: 2,
          border: '1px dashed',
          borderColor: 'divider',
          bgcolor: 'action.hover',
          textAlign: 'center',
        }}
      >
        {!hasImage && (
          <>
            <CreditCardIcon color="disabled" />
            <Typography variant="body2" color="text.secondary">
              No {label.toLowerCase()} image
            </Typography>
          </>
        )}

        {hasImage && !revealed && (
          <>
            <VisibilityOffIcon color="disabled" />
            <Typography variant="body2" color="text.secondary">
              {label} image hidden
            </Typography>
            <Button
              size="small"
              startIcon={<VisibilityIcon />}
              onClick={handleReveal}
              aria-label={`Reveal ${label.toLowerCase()} image`}
            >
              Reveal
            </Button>
          </>
        )}

        {hasImage && revealed && status === 'loading' && (
          <CircularProgress size={24} aria-label={`Loading ${label.toLowerCase()} image`} />
        )}

        {hasImage && revealed && status === 'error' && (
          <Stack spacing={1} alignItems="center" sx={{ width: '100%' }}>
            <Alert severity="error" sx={{ width: '100%', textAlign: 'left' }}>
              {loadError ?? 'This image could not be loaded.'}
            </Alert>
            <Button size="small" onClick={() => void loadUrl()}>
              Retry
            </Button>
          </Stack>
        )}

        {hasImage && revealed && status === 'ready' && url && (
          <Box
            component="img"
            src={url}
            alt={`${label} of card`}
            onError={handleImageError}
            sx={{ display: 'block', maxWidth: '100%', height: 'auto', borderRadius: 1 }}
          />
        )}
      </Box>

      {hasImage && revealed && status === 'ready' && (
        <Button
          size="small"
          startIcon={<VisibilityOffIcon />}
          onClick={handleHide}
          aria-label={`Hide ${label.toLowerCase()} image`}
          sx={{ alignSelf: 'flex-start' }}
        >
          Hide
        </Button>
      )}

      {actionError && (
        <Alert severity="error" onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      {!readOnly && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            hidden
            accept={ACCEPTED_MIME_TYPES.join(',')}
            aria-label={`${label} image file`}
            onChange={handleFileChange}
          />
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="outlined"
              startIcon={busy ? <CircularProgress size={14} /> : <UploadIcon />}
              onClick={handleUploadClick}
              disabled={busy}
            >
              {hasImage ? `Replace ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}
            </Button>
            {hasImage && (
              <Button
                size="small"
                color="error"
                startIcon={<DeleteIcon />}
                onClick={() => void handleRemove()}
                disabled={busy}
              >
                Remove {label.toLowerCase()}
              </Button>
            )}
          </Stack>
        </>
      )}
    </Paper>
  );
}

export interface CardImagesProps {
  secretId: string;
  attachments: SecretAttachment[];
  /** Called after an upload or removal so the caller can refetch the secret. */
  onChange?: () => void;
  /** Historical versions are immutable — no upload or remove controls. */
  readOnly?: boolean;
  title?: string;
}

/**
 * Front and back card face images for a secret.
 *
 * Both faces stay concealed until the viewer asks for them: a card photo shows
 * the number, the holder's name and often the signature strip, so it is card
 * data in exactly the same sense as the fields in `DynamicSecretFields`, and is
 * gated the same way.
 */
export function CardImages({
  secretId,
  attachments,
  onChange,
  readOnly = false,
  title = 'Card Images',
}: CardImagesProps) {
  const handleChange = useCallback(() => {
    onChange?.();
  }, [onChange]);

  return (
    <Box>
      <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
        {title}
      </Typography>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        alignItems="stretch"
      >
        {SLOTS.map(({ role, label }) => (
          <CardImageSlot
            key={role}
            secretId={secretId}
            role={role}
            label={label}
            attachment={findCardImage(attachments, role)}
            readOnly={readOnly}
            onChange={handleChange}
          />
        ))}
      </Stack>
    </Box>
  );
}
