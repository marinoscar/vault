import { Alert, AlertTitle, Typography } from '@mui/material';

interface AiEgressNoticeProps {
  /** Rendered as a plain box rather than a warning once the user has consented. */
  variant?: 'prominent' | 'inline';
}

/**
 * Explicit notice that the card photographs leave this server for OpenAI.
 *
 * This is a real third-party data egress involving a payment instrument, so it
 * is a warning the user reads before the call happens — not a line of fine
 * print under the button. The two facts that matter to someone deciding are
 * both stated: what is sent (a cropped image), and what is deliberately not
 * (the CVV, which is never asked for and never returned).
 */
export function AiEgressNotice({ variant = 'prominent' }: AiEgressNoticeProps) {
  return (
    <Alert severity={variant === 'prominent' ? 'warning' : 'info'} sx={{ mb: 2 }}>
      <AlertTitle>Your card photo will be sent to OpenAI</AlertTitle>
      <Typography variant="body2" component="div">
        To read the details, the cropped photo of your card is sent to OpenAI.
        Only the cropped card rectangle is sent — the rest of the picture never
        leaves this device. Nothing is stored by this app until you confirm the
        details on the next screen.
      </Typography>
      <Typography variant="body2" component="div" sx={{ mt: 1 }}>
        Your CVV / CVC is never sent and never read from the photo. You will type
        it in yourself.
      </Typography>
    </Alert>
  );
}
