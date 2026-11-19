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
  Badge as BadgeIcon,
} from '@mui/icons-material';
import {
  DOCUMENT_IMAGE_SLOTS,
  documentNoun,
  imageSlotsFor,
  type DocumentImageSlot,
} from '@marinoscar/vault-contract/secrets';
import {
  getStorageObjectDownloadUrl,
  linkSecretAttachment,
  simpleStorageUpload,
  unlinkSecretAttachment,
} from '../../../core/headless/api.js';
import { CARD_TYPE_NAME } from '../../../cards/headless/useCards.js';
import type { AttachmentRole, SecretAttachment, SecretType } from '../../../core/headless/types.js';
import { SECRET_REVEAL_TIMEOUT_MS } from '../../headless/secretFields.js';

/**
 * Mirror of the API's document image allowlist (`CARD_IMAGE_MIME_TYPES` in
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

/** Mirror of the API's `DEFAULT_CARD_IMAGE_MAX_BYTES` (it caps every document image). */
const MAX_CARD_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Strip parameters and casing from a mime type so `image/jpeg; charset=binary`
 * compares equal to `image/jpeg`, matching the API's normalisation.
 */
function normalizeMimeType(mimeType: string): string {
  return (mimeType ?? '').split(';')[0].trim().toLowerCase();
}

/**
 * Whether a secret should offer document image slots (card faces, a passport's
 * data page, an ID document's front and back).
 *
 * Attachments are the gate: a type that forbids them can never hold a
 * document image. Beyond that, a type with image slots (`imageSlotsFor`)
 * always gets them, so a brand new card or passport offers somewhere to put
 * its photos, and any other type gets them only once it actually holds a
 * role-bearing attachment — which keeps a Document, whose attachments are all
 * role-less, completely unaffected.
 */
export function supportsDocumentImages(
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
  if (imageSlotsFor(type).length > 0) {
    return true;
  }
  return hasRoleAttachment;
}

/**
 * The image slots to render for a secret: those of its type, or, for a type
 * without slots that still holds role-bearing attachments (written before
 * roles were checked against the type), the slot list those roles belong to.
 * With no type at all the Card slots are used, as `CardImages` always did.
 */
export function documentImageSlotsFor(
  type: Pick<SecretType, 'name' | 'isSystem'> | null | undefined,
  attachments: SecretAttachment[] = [],
): readonly DocumentImageSlot[] {
  const own = type ? imageSlotsFor(type) : [];
  if (own.length > 0) return own;
  const held = new Set(attachments.map((a) => a.role).filter(Boolean));
  const match = Object.values(DOCUMENT_IMAGE_SLOTS).find((slots) => slots.some((slot) => held.has(slot.role)));
  return match ?? DOCUMENT_IMAGE_SLOTS[CARD_TYPE_NAME];
}

/**
 * The type name the image slots in use belong to ("Card", "Passport"), for
 * headings: the name of the slot list `documentImageSlotsFor` picks.
 */
export function documentImagesTypeName(
  type: Pick<SecretType, 'name' | 'isSystem'> | null | undefined,
  attachments: SecretAttachment[] = [],
): string {
  const slots = documentImageSlotsFor(type, attachments);
  return Object.entries(DOCUMENT_IMAGE_SLOTS).find(([, list]) => list === slots)?.[0] ?? type?.name ?? CARD_TYPE_NAME;
}

/** Pick the single attachment holding a given image role, if any. */
export function findDocumentImage(
  attachments: SecretAttachment[],
  role: AttachmentRole,
): SecretAttachment | undefined {
  return attachments.find((a) => a.role === role);
}

type ImageStatus = 'idle' | 'loading' | 'ready' | 'error';

interface DocumentImageSlotProps {
  secretId: string;
  role: AttachmentRole;
  label: string;
  /** "card", "passport", "ID document": names the document in alt text and messages. */
  documentName: string;
  attachment: SecretAttachment | undefined;
  readOnly: boolean;
  revealTimeoutMs: number;
  onChange: () => void;
}

function DocumentImageSlotView({
  secretId,
  role,
  label,
  documentName,
  attachment,
  readOnly,
  revealTimeoutMs,
  onChange,
}: DocumentImageSlotProps) {
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

  // Conceal again after the same timeout as a revealed value, and drop the
  // signed URL so the next reveal mints a fresh one.
  useEffect(() => {
    if (!revealed || revealTimeoutMs <= 0) return undefined;
    const timer = setTimeout(() => {
      setRevealed(false);
      setUrl(null);
      setStatus('idle');
    }, revealTimeoutMs);
    return () => clearTimeout(timer);
  }, [revealed, revealTimeoutMs]);

  // Conceal when the browser tab is hidden. Leaving the Attachments tab or the
  // route unmounts the slot, which drops the revealed state with it.
  useEffect(() => {
    if (!revealed || typeof document === 'undefined') return undefined;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        setRevealed(false);
        setUrl(null);
        setStatus('idle');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [revealed]);

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
        setActionError(`${capitalize(documentName)} images must be a JPEG, PNG, WebP, or HEIC image.`);
        return;
      }
      if (file.size > MAX_CARD_IMAGE_BYTES) {
        setActionError(`${capitalize(documentName)} images must be 5 MB or smaller.`);
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
    [secretId, attachmentId, role, onChange, documentName],
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
            {documentName === 'card' ? <CreditCardIcon color="disabled" /> : <BadgeIcon color="disabled" />}
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>
              No {label.toLowerCase()} image
            </Typography>
          </>
        )}

        {hasImage && !revealed && (
          <>
            <VisibilityOffIcon color="disabled" />
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>
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
          <Stack
            spacing={1}
            sx={{
              alignItems: "center",
              width: '100%'
            }}>
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
            alt={`${label} of ${documentName}`}
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

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface DocumentImagesProps {
  secretId: string;
  attachments: SecretAttachment[];
  /**
   * The secret's type: its image slots come from `imageSlotsFor(type)`.
   * Omitted, the Card slots are shown (the `CardImages` behaviour).
   */
  type?: Pick<SecretType, 'name' | 'isSystem'> | null;
  /** Called after an upload or removal so the caller can refetch the secret. */
  onChange?: () => void;
  /** Historical versions are immutable — no upload or remove controls. */
  readOnly?: boolean;
  /** Heading; defaults to "<Type> Images" ("Card Images", "Passport Images"). */
  title?: string;
  /** Conceals a revealed image again after this many ms; defaults to `SECRET_REVEAL_TIMEOUT_MS` (30 s). */
  revealTimeoutMs?: number;
}

/**
 * The stored document images of a secret: a card's front and back, a
 * passport's data page and other page, an ID document's front and back.
 *
 * Every image stays concealed until the viewer asks for it, and is concealed
 * again after the reveal timeout, when the browser tab is hidden, or when the
 * attachment changes: a document photo shows the number, the holder's name
 * and often a signature or portrait, so it is as sensitive as the fields in
 * `DynamicSecretFields`, and is gated the same way.
 */
export function DocumentImages({
  secretId,
  attachments,
  type,
  onChange,
  readOnly = false,
  title,
  revealTimeoutMs = SECRET_REVEAL_TIMEOUT_MS,
}: DocumentImagesProps) {
  const handleChange = useCallback(() => {
    onChange?.();
  }, [onChange]);

  const slots = documentImageSlotsFor(type, attachments);
  // Name the document after the slot list in use, so a Card without a type
  // prop still reads "card".
  const typeName = documentImagesTypeName(type, attachments);
  const documentName = documentNoun(typeName);
  const heading = title ?? `${typeName} Images`;

  return (
    <Box>
      <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
        {heading}
      </Typography>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{
          alignItems: "stretch"
        }}
      >
        {slots.map(({ role, label }) => (
          <DocumentImageSlotView
            key={role}
            secretId={secretId}
            role={role}
            label={label}
            documentName={documentName}
            attachment={findDocumentImage(attachments, role)}
            readOnly={readOnly}
            revealTimeoutMs={revealTimeoutMs}
            onChange={handleChange}
          />
        ))}
      </Stack>
    </Box>
  );
}
