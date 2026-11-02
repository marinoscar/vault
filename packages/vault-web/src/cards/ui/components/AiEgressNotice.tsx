import { Alert, AlertTitle, Box, Typography } from '@mui/material';
import { CloudUploadOutlined as EgressIcon } from '@mui/icons-material';

/**
 * Explicit notice that the card photographs leave this server for OpenAI.
 *
 * This is a real third-party data egress involving a payment instrument, so it
 * is a warning the user reads before the call happens — not a line of fine
 * print under the button. It sits at the top of the capture step, above the
 * camera button, and stays there for both photos (E10.5, issue #96). The facts
 * that matter to someone deciding are all stated: what is sent (the FULL
 * photo, so the model can locate the card), what is stored (only the cropped
 * card rectangle), and that the security code is never taken from the photo:
 * the user types it on the review step.
 */
export function AiEgressNotice() {
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
