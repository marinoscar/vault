import { Alert, AlertTitle, Box, Chip, FormHelperText, Stack, Typography } from '@mui/material';
import {
  AutoAwesomeOutlined as AiIcon,
  WarningAmber as WarningIcon,
} from '@mui/icons-material';
import type { DocumentCheckResult } from '@marinoscar/vault-contract/secrets';

import type { FieldDefinition } from '../../../core/headless/types.js';
import type { KeyValueSuggestion } from '../../../secrets/headless/keyValue.js';
import { DynamicSecretFields } from '../../../secrets/ui/components/DynamicSecretFields.js';

export interface DocumentReviewFormProps {
  /** The Passport or ID Document type's fields, rendered in order. */
  fields: FieldDefinition[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  /** Fields whose current value was read by the AI and not edited since ("AI" chip). */
  aiFields?: ReadonlySet<string>;
  /** Fields the model was unsure about ("Check" chip and an amber outline). */
  lowConfidenceFields?: ReadonlySet<string>;
  /** The confidence of the AI's `document_kind` guess, shown on its "AI guessed" chip. */
  kindConfidence?: number | null;
  /** `attributes` entry keys read with low confidence (outlined rows). */
  flaggedAttributes?: ReadonlySet<string>;
  /** Suggested `attributes` entries (the chosen kind's standard keys). */
  keyValueSuggestions?: Readonly<Record<string, readonly KeyValueSuggestion[]>>;
  /** The deterministic checks of the scan; failures are listed at the top. */
  checks?: readonly DocumentCheckResult[];
  /** The scan's warnings, listed with the failed checks. */
  warnings?: readonly string[];
  errors?: Record<string, string>;
  disabled?: boolean;
}

const CHECK_TEXT: Record<DocumentCheckResult['id'], string> = {
  mrz: 'The machine readable zone did not pass its check digits',
  ssn: 'The number does not look like a valid Social Security number',
  vin: 'The vehicle identification number did not pass its check digit',
  aamva: 'The barcode on the back disagreed with the printed values; the barcode was used',
};

const LOW_CONFIDENCE_HELPER = 'The photo was hard to read here. Check this against the document.';

const chipSx = { height: 18, fontSize: 11, '& .MuiChip-icon': { fontSize: 12 } } as const;

/**
 * Editable review of a scanned passport or ID document.
 *
 * The typed fields are the type's own editors (`DynamicSecretFields`: the
 * country picker, the key/value editor, the dates); each value the AI read is
 * marked "AI", each it was unsure of (confidence at or below 0.7) "Check" with
 * an amber outline. The document kind carries an "AI guessed" chip with the
 * model's confidence while it is the AI's guess. Failed checks and warnings
 * share one alert at the top. Nothing is trusted: every value is editable.
 */
export function DocumentReviewForm({
  fields,
  values,
  onChange,
  aiFields,
  lowConfidenceFields,
  kindConfidence,
  flaggedAttributes,
  keyValueSuggestions,
  checks = [],
  warnings = [],
  errors = {},
  disabled = false,
}: DocumentReviewFormProps) {
  const labelOf = (name: string) => fields.find((f) => f.name === name)?.label ?? name;
  const failedChecks = checks.filter((check) => !check.ok);
  const notices = [
    ...failedChecks.map((check) =>
      check.failed.length > 0
        ? `${CHECK_TEXT[check.id]} (${check.failed.map((name) => labelOf(name.replace(/^attributes\./, ''))).join(', ')}).`
        : `${CHECK_TEXT[check.id]}.`,
    ),
    ...warnings,
  ];
  const keyValueFlags = flaggedAttributes && flaggedAttributes.size > 0 ? { attributes: flaggedAttributes } : undefined;

  return (
    <Box>
      {notices.length > 0 && (
        <Alert severity="warning" icon={<WarningIcon />} sx={{ mb: 2 }}>
          <AlertTitle>Check these before saving</AlertTitle>
          <Box component="ul" sx={{ pl: 2, m: 0 }}>
            {notices.map((notice) => (
              <li key={notice}>
                <Typography variant="body2">{notice}</Typography>
              </li>
            ))}
          </Box>
        </Alert>
      )}

      <Box component="fieldset" disabled={disabled} sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
        <Stack spacing={2}>
          {fields.map((field) => {
            const raw = values[field.name];
            const hasValue = Array.isArray(raw) ? raw.length > 0 : typeof raw === 'string' && raw.trim() !== '';
            const isAi = hasValue && (aiFields?.has(field.name) ?? false);
            const isLow = hasValue && !errors[field.name] && (lowConfidenceFields?.has(field.name) ?? false);
            const isKindGuess = field.name === 'document_kind' && isAi;
            return (
              <Box
                key={field.name}
                data-testid={`review-field-${field.name}`}
                sx={
                  isLow
                    ? { '& .MuiOutlinedInput-notchedOutline': { borderColor: 'secondary.main', borderWidth: 2 } }
                    : undefined
                }
              >
                {(isAi || isLow) && (
                  <Box sx={{ display: 'flex', gap: 0.5, mb: 0.75, flexWrap: 'wrap' }}>
                    {isKindGuess ? (
                      <Chip
                        icon={<AiIcon />}
                        size="small"
                        color="primary"
                        variant="outlined"
                        label={
                          typeof kindConfidence === 'number'
                            ? `AI guessed · ${Math.round(kindConfidence * 100)}%`
                            : 'AI guessed'
                        }
                        aria-label={`${field.label} guessed by AI`}
                        sx={chipSx}
                      />
                    ) : (
                      isAi &&
                      !isLow && (
                        <Chip
                          icon={<AiIcon />}
                          size="small"
                          color="primary"
                          variant="outlined"
                          label="AI"
                          aria-label={`${field.label} read by AI`}
                          sx={chipSx}
                        />
                      )
                    )}
                    {isLow && (
                      <Chip
                        size="small"
                        color="secondary"
                        label="Check"
                        aria-label={`Check ${field.label}`}
                        sx={{ ...chipSx, fontWeight: 600 }}
                      />
                    )}
                  </Box>
                )}
                <DynamicSecretFields
                  fields={[field]}
                  data={values}
                  onChange={onChange}
                  errors={errors}
                  keyValueSuggestions={keyValueSuggestions}
                  keyValueFlags={keyValueFlags}
                />
                {isLow && <FormHelperText sx={{ mx: 1.75 }}>{LOW_CONFIDENCE_HELPER}</FormHelperText>}
              </Box>
            );
          })}
        </Stack>
      </Box>
    </Box>
  );
}
