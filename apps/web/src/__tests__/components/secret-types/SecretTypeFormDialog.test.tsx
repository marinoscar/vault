import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import { SecretTypeFormDialog } from '../../../components/secret-types/SecretTypeFormDialog';
import type { SecretType } from '../../../types';

const baseType: SecretType = {
  id: 'type-1',
  name: 'Payment Card',
  description: null,
  icon: null,
  fields: [
    {
      name: 'card_network',
      label: 'Card Network',
      type: 'select',
      required: true,
      sensitive: false,
      options: ['Visa', 'Mastercard'],
    },
  ],
  allowAttachments: false,
  isSystem: false,
  createdAt: new Date().toISOString(),
};

function renderDialog(editType: SecretType, onSave = vi.fn()) {
  render(
    <SecretTypeFormDialog
      open
      onClose={vi.fn()}
      onSave={onSave}
      editType={editType}
    />,
  );
  return onSave;
}

describe('SecretTypeFormDialog select fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads the options of an existing select field for editing', () => {
    renderDialog(baseType);

    const optionInputs = screen.getAllByRole('textbox', {
      name: /^option \d+ for card network$/i,
    });
    expect(optionInputs.map((input) => (input as HTMLInputElement).value)).toEqual([
      'Visa',
      'Mastercard',
    ]);
  });

  it('saves a type whose select field has valid options', async () => {
    const user = userEvent.setup();
    const onSave = renderDialog(baseType, vi.fn().mockResolvedValue(undefined));

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].fields[0].options).toEqual(['Visa', 'Mastercard']);
  });

  it('does not save while a select field has no options', async () => {
    const user = userEvent.setup();
    const onSave = renderDialog({
      ...baseType,
      fields: [{ ...baseType.fields[0], options: [] }],
    });

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByText(/card network: add at least one option/i),
    ).toBeInTheDocument();
  });

  it('does not save while a select field has duplicate options', async () => {
    const user = userEvent.setup();
    const onSave = renderDialog({
      ...baseType,
      fields: [{ ...baseType.fields[0], options: ['Visa', 'Visa'] }],
    });

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(onSave).not.toHaveBeenCalled();
  });
});
