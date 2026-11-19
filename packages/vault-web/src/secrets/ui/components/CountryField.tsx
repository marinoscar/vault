import { Autocomplete, TextField, createFilterOptions } from '@mui/material';
import { COUNTRY_TABLE, type CountryEntry } from '@marinoscar/vault-contract/common';
import { findCountry, formatCountryLabel } from '../../headless/country.js';

export interface CountryFieldProps {
  label: string;
  /** The stored alpha-3 code ('' when empty). */
  value: string;
  /** Called with the chosen alpha-3 code, or '' when cleared. */
  onChange: (code: string) => void;
  required?: boolean;
  disabled?: boolean;
  error?: boolean;
  helperText?: string;
}

const filterOptions = createFilterOptions<CountryEntry>({
  // Match the name, the alpha-3 and the alpha-2 code.
  stringify: (option) => `${option.name} ${option.alpha3} ${option.alpha2 ?? ''}`,
});

/**
 * A `format: 'country'` field: an autocomplete over the contract's country
 * table showing `"<name> (<alpha3>)"`, storing the alpha-3 code. A stored code
 * that is not in the table stays visible (as itself) rather than being
 * silently cleared, and validation flags it.
 */
export function CountryField({
  label,
  value,
  onChange,
  required,
  disabled,
  error,
  helperText,
}: CountryFieldProps) {
  const known = findCountry(value);
  const trimmed = value.trim();
  const orphan: CountryEntry | null =
    !known && trimmed !== '' ? { alpha3: trimmed, alpha2: null, name: 'Unknown code' } : null;
  const selected = known ?? orphan;
  const options = orphan ? [orphan, ...COUNTRY_TABLE] : (COUNTRY_TABLE as CountryEntry[]);

  return (
    <Autocomplete<CountryEntry>
      options={options}
      value={selected}
      onChange={(_event, option) => onChange(option ? option.alpha3 : '')}
      getOptionLabel={formatCountryLabel}
      isOptionEqualToValue={(option, current) => option.alpha3 === current.alpha3}
      filterOptions={filterOptions}
      disabled={disabled}
      autoHighlight
      fullWidth
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          required={required}
          error={error}
          helperText={helperText}
        />
      )}
    />
  );
}
