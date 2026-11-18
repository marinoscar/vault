import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render } from '../utils/test-utils.js';
import { SecretForm } from '../../src/secrets/ui/components/SecretForm.js';
import {
  TOTP_FIELD_HELP,
  fieldErrorsFromApiError,
  validateSecretFields,
} from '../../src/secrets/headless/secretFields.js';
import type { SecretType } from '../../src/core/headless/types.js';

// RFC 6238 test seed ("12345678901234567890" in base32).
const SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const URI = `otpauth://totp/Example:person@example.test?secret=${SEED}&issuer=Example`;

const CREDENTIAL: SecretType = {
  id: 'type-cred', name: 'Credential', description: null, icon: null,
  isSystem: true, allowAttachments: false, createdAt: '2026-01-01T00:00:00Z',
  fields: [
    { name: 'username', label: 'Username', type: 'string', required: true, sensitive: false },
    { name: 'totp', label: 'Authenticator key (TOTP)', type: 'string', required: false, sensitive: true },
  ],
};

describe('totp validation', () => {
  it('accepts a URI, a base32 key and empty; rejects junk', () => {
    const f = CREDENTIAL.fields;
    expect(validateSecretFields(f, { username: 'a', totp: URI })).toEqual({});
    expect(validateSecretFields(f, { username: 'a', totp: SEED })).toEqual({});
    expect(validateSecretFields(f, { username: 'a', totp: '' })).toEqual({});
    expect(validateSecretFields(f, { username: 'a', totp: 'not a key!' }).totp).toBe(TOTP_FIELD_HELP);
    expect(validateSecretFields(f, { username: 'a', totp: 'otpauth://hotp/x?secret=' + SEED }).totp).toBe(TOTP_FIELD_HELP);
  });

  it('maps the API field error to the field', () => {
    const err = { status: 400, details: { errors: ['Field "totp" is not a valid authenticator key'] } };
    expect(fieldErrorsFromApiError(err, CREDENTIAL.fields)).toEqual({ totp: TOTP_FIELD_HELP });
    expect(fieldErrorsFromApiError(new Error('x'), CREDENTIAL.fields)).toEqual({});
  });
});

describe('SecretForm totp field', () => {
  async function fill(user: ReturnType<typeof userEvent.setup>, key: string) {
    await user.type(screen.getByLabelText(/^Name/), 'Site');
    await user.type(screen.getByLabelText(/^Username/), 'person-a');
    if (key) await user.type(screen.getByLabelText(/Authenticator key/), key);
    await user.click(screen.getByRole('button', { name: 'Save' }));
  }
  const props = (onSubmit: () => Promise<void>) => ({
    mode: 'edit' as const, types: [CREDENTIAL],
    initial: { name: '', description: '', typeId: 'type-cred', data: {} },
    submitLabel: 'Save', submittingLabel: 'Saving', onSubmit, onCancel: vi.fn(),
  });

  it('masks the field and blocks junk with the inline help', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<SecretForm {...props(onSubmit)} />);
    expect(screen.getByLabelText(/Authenticator key/)).toHaveAttribute('type', 'password');
    await fill(user, 'junk!!');
    expect(await screen.findByText(TOTP_FIELD_HELP)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits a base32 key', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<SecretForm {...props(onSubmit)} />);
    await fill(user, SEED);
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  });

  it('shows the API 400 on the field', async () => {
    const onSubmit = vi.fn().mockRejectedValue(
      Object.assign(new Error('Validation failed'), { status: 400, details: { errors: ['Field "totp" is invalid'] } }),
    );
    const user = userEvent.setup();
    render(<SecretForm {...props(onSubmit)} />);
    await fill(user, SEED);
    expect(await screen.findByText(TOTP_FIELD_HELP)).toBeInTheDocument();
  });
});
