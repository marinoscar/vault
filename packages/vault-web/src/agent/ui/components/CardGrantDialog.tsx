import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material';

import type { CreateCardGrant } from '../../headless/cardGrants.js';

export interface CardGrantDialogProps {
  open: boolean;
  /** The card's name, shown in the title. */
  cardName: string;
  onClose: () => void;
  /** Creates the grant; throws on failure (the dialog shows `errorMessage(err)`). */
  onSubmit: (body: CreateCardGrant) => Promise<void>;
  errorMessage: (err: unknown) => string;
}

type Period = 'none' | 'day' | 'month';

const AMOUNT = /^\d{1,8}(\.\d{1,2})?$/;
const CURRENCY = /^[A-Za-z]{3}$/;
const WHOLE = /^\d{1,4}$/;

/** `https://shop.example.test` or `shop.example.test`; the API normalizes and has the last word. */
function looksLikeOrigin(text: string): boolean {
  const value = text.trim();
  if (!value || /\s/.test(value)) return false;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    return url.protocol === 'https:' && !!url.hostname;
  } catch {
    return false;
  }
}

const splitOrigins = (text: string) => text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);

/**
 * The "Allow a shop" form of a card (ADR-0003): the merchant, the maximum per purchase and its
 * currency (required), optional payment frames, an optional limit per day or month, an optional
 * end date and the security code (off by default). Validates before it sends; the API validates again.
 */
export function CardGrantDialog({ open, cardName, onClose, onSubmit, errorMessage }: CardGrantDialogProps) {
  const [merchant, setMerchant] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [frames, setFrames] = useState('');
  const [period, setPeriod] = useState<Period>('none');
  const [periodReleases, setPeriodReleases] = useState('');
  const [periodAmount, setPeriodAmount] = useState('');
  const [expires, setExpires] = useState('');
  const [securityCode, setSecurityCode] = useState(false);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const errors = {
    merchant: looksLikeOrigin(merchant) ? null : 'Enter the shop\'s website, for example shop.example.test.',
    maxAmount: AMOUNT.test(maxAmount) && Number(maxAmount) > 0 ? null : 'Enter an amount greater than 0, with at most two decimals.',
    currency: CURRENCY.test(currency) ? null : 'Enter a three-letter currency code, for example USD.',
    frames: splitOrigins(frames).every(looksLikeOrigin) ? null : 'Each payment frame must be a website, separated by spaces or commas.',
    periodReleases: period === 'none' || periodReleases === '' || (WHOLE.test(periodReleases) && Number(periodReleases) > 0) ? null : 'Enter a whole number.',
    periodAmount: period === 'none' || periodAmount === '' || (AMOUNT.test(periodAmount) && Number(periodAmount) > 0) ? null : 'Enter an amount greater than 0.',
    periodAny: period === 'none' || periodReleases !== '' || periodAmount !== '' ? null : 'Set a number of uses, a total, or both.',
    expires: expires === '' || new Date(`${expires}T23:59:59`).getTime() > Date.now() ? null : 'Choose a date in the future.',
  };
  const valid = Object.values(errors).every((e) => e === null);
  const show = (key: keyof typeof errors) => (touched ? errors[key] : null);

  const reset = () => {
    setMerchant('');
    setMaxAmount('');
    setCurrency('USD');
    setFrames('');
    setPeriod('none');
    setPeriodReleases('');
    setPeriodAmount('');
    setExpires('');
    setSecurityCode(false);
    setTouched(false);
    setFailure(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    setTouched(true);
    if (!valid) return;
    setSaving(true);
    setFailure(null);
    try {
      await onSubmit({
        merchantOrigin: merchant.trim(),
        frameOrigins: splitOrigins(frames),
        maxAmount: Number(maxAmount),
        currency: currency.toUpperCase(),
        periodLimit:
          period === 'none'
            ? null
            : {
                period,
                ...(periodReleases ? { maxReleases: Number(periodReleases) } : {}),
                ...(periodAmount ? { maxAmount: Number(periodAmount) } : {}),
              },
        expiresAt: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
        includeSecurityCode: securityCode,
      });
      reset();
      onClose();
    } catch (err) {
      setFailure(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : close} fullWidth maxWidth="sm" aria-labelledby="card-grant-dialog-title">
      <DialogTitle id="card-grant-dialog-title">Allow a shop for {cardName}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          Agents can use this card only at this shop and its subdomains, up to the amount you set. A use is not a payment:
          the shop still charges the card.
        </Typography>
        {failure && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {failure}
          </Alert>
        )}
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' } }}>
          <TextField
            label="Shop website"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            error={!!show('merchant')}
            helperText={show('merchant') ?? 'The address of the checkout page, for example https://shop.example.test'}
            required
            sx={{ gridColumn: { sm: '1 / -1' } }}
          />
          <TextField
            label="Most per purchase"
            value={maxAmount}
            onChange={(e) => setMaxAmount(e.target.value)}
            error={!!show('maxAmount')}
            helperText={show('maxAmount') ?? ' '}
            required
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
          />
          <TextField
            label="Currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            error={!!show('currency')}
            helperText={show('currency') ?? ' '}
            required
            slotProps={{ htmlInput: { maxLength: 3, autoCapitalize: 'characters' } }}
          />
          <TextField
            label="Payment frames (optional)"
            value={frames}
            onChange={(e) => setFrames(e.target.value)}
            error={!!show('frames')}
            helperText={show('frames') ?? 'Websites of embedded payment forms this shop uses, if any'}
            sx={{ gridColumn: { sm: '1 / -1' } }}
          />
          <TextField
            select
            label="Limit"
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            helperText={show('periodAny') ?? ' '}
            error={!!show('periodAny')}
            sx={{ gridColumn: { sm: '1 / -1' } }}
          >
            <MenuItem value="none">No limit beyond the amount per purchase</MenuItem>
            <MenuItem value="day">Per day</MenuItem>
            <MenuItem value="month">Per month</MenuItem>
          </TextField>
          {period !== 'none' && (
            <>
              <TextField
                label={`Uses per ${period}`}
                value={periodReleases}
                onChange={(e) => setPeriodReleases(e.target.value)}
                error={!!show('periodReleases')}
                helperText={show('periodReleases') ?? ' '}
                slotProps={{ htmlInput: { inputMode: 'numeric' } }}
              />
              <TextField
                label={`Total per ${period}`}
                value={periodAmount}
                onChange={(e) => setPeriodAmount(e.target.value)}
                error={!!show('periodAmount')}
                helperText={show('periodAmount') ?? ' '}
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
              />
            </>
          )}
          <TextField
            label="Ends on (optional)"
            type="date"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
            error={!!show('expires')}
            helperText={show('expires') ?? ' '}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ gridColumn: { sm: '1 / -1' } }}
          />
        </Box>
        <FormControlLabel
          sx={{ alignItems: 'flex-start', m: 0, mt: 1, gap: 1 }}
          control={<Switch checked={securityCode} onChange={(e) => setSecurityCode(e.target.checked)} />}
          label={
            <Box sx={{ pt: 0.75 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Include the security code
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Off unless this shop asks for it at every purchase.
              </Typography>
            </Box>
          }
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={close} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void submit()} disabled={saving}>
          Allow shop
        </Button>
      </DialogActions>
    </Dialog>
  );
}
