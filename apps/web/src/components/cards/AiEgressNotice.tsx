import { Alert, AlertTitle, Typography } from '@mui/material';

/**
 * Explicit notice that the card photographs leave this server for OpenAI.
 *
 * This is a real third-party data egress involving a payment instrument, so it
 * is a warning the user reads before the call happens — not a line of fine
 * print under the button. The facts that matter to someone deciding are all
 * stated: what is sent (the FULL photo, so the model can locate the card),
 * what is stored (only the cropped card rectangle), and what is deliberately
 * neither (the CVV, which is never asked for and never returned).
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
        Your CVV / CVC is never read from the photo. You will type it in
        yourself.
      </Typography>
    </Alert>
  );
}
