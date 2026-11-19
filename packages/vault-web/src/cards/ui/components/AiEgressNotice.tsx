import { Alert, AlertTitle, Box, Typography } from '@mui/material';
import { CloudUploadOutlined as EgressIcon } from '@mui/icons-material';

interface AiEgressNoticeProps {
  /**
   * `card` (default): the card import's wording, with the security-code line.
   * `document`: a passport or ID document scan.
   */
  variant?: 'card' | 'document';
}

/**
 * Explicit notice that the photographs leave this server for OpenAI.
 *
 * This is a real third-party data egress (a payment instrument or an identity
 * document), so it is a warning the user reads before the call happens — not a
 * line of fine print under the button. It sits at the top of the capture step,
 * above the camera button, and stays there for every photo (E10.5, issue #96).
 * The facts that matter to someone deciding are all stated: what is sent (the
 * FULL photo, so the model can locate the card or document), what is stored
 * (only the cropped rectangle) and, for a card, that the security code is
 * never taken from the photo: the user types it on the review step.
 */
export function AiEgressNotice({ variant = 'card' }: AiEgressNoticeProps) {
  if (variant === 'document') {
    const title = 'Your document photos will be sent to OpenAI';
    return (
      <Alert severity="warning" icon={<EgressIcon />} sx={{ mb: 2 }} role="note" aria-label={title}>
        <AlertTitle sx={{ fontWeight: 600 }}>{title}</AlertTitle>
        <Typography variant="body2" component="div">
          The full photos go to the AI model configured in Console → AI (OpenAI) so it
          can find the document in the frame, tell what kind it is and read what is
          printed on it. Only the cropped document is stored, and only once you save.
        </Typography>
        <Box component="div" sx={{ mt: 1 }}>
          <Typography variant="body2" component="div">
            Nothing is saved until you have checked every detail on the review step.
          </Typography>
        </Box>
      </Alert>
    );
  }
  return (
    <Alert
      severity="warning"
      icon={<EgressIcon />}
      sx={{ mb: 2 }}
      role="note"
      aria-label="Your card photo will be sent to OpenAI"
    >
      <AlertTitle sx={{ fontWeight: 600 }}>Your card photo will be sent to OpenAI</AlertTitle>
      <Typography variant="body2" component="div">
        The full photo goes to OpenAI so it can find the card in the frame and
        read what is printed on it. Only the cropped card is stored, and only
        once you save.
      </Typography>
      <Box component="div" sx={{ mt: 1 }}>
        <Typography variant="body2" component="div">
          Your security code (CVV / CVC) is never filled in from the photo: you
          type it yourself on the review step.
        </Typography>
      </Box>
    </Alert>
  );
}
