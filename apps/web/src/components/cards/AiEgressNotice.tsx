import { Alert, AlertTitle, Typography } from '@mui/material';

/**
 * Explicit notice that the card photographs leave this server for OpenAI.
 *
 * This is a real third-party data egress involving a payment instrument, so it
 * is a warning the user reads before the call happens — not a line of fine
 * print under the button. The facts that matter to someone deciding are all
 * stated: what is sent (the FULL photo, so the model can locate the card),
 * what is stored (only the cropped card rectangle), and — because it is the
 * detail a reader is most likely to assume otherwise — that the security code
 * is among what is read and saved.
 */
export function AiEgressNotice() {
  return (
    <Alert severity="warning" sx={{ mb: 2 }}>
      <AlertTitle>Your card photo will be sent to OpenAI</AlertTitle>
      <Typography variant="body2" component="div">
        To read the details, the full photo is sent to OpenAI, which finds the
        card in the frame and reads what is printed on it. Only the cropped
        card rectangle is kept as the stored photo — the full picture is never
        uploaded to storage, and nothing is stored by this app until you
        confirm the details on the next screen.
      </Typography>
      <Typography variant="body2" component="div" sx={{ mt: 1 }}>
        This includes your security code (CVV / CVC): it is read from the photo
        along with everything else and saved, encrypted, with the card. Check it
        on the next screen before saving.
      </Typography>
    </Alert>
  );
}
