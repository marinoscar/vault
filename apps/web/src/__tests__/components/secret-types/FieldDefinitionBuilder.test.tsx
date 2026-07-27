import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import { FieldDefinitionBuilder } from '../../../components/secret-types/FieldDefinitionBuilder';
import type { FieldDefinition } from '../../../types';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const fieldA: FieldDefinition = {
  name: 'username',
  label: 'Username',
  type: 'string',
  required: true,
  sensitive: false,
};

const fieldB: FieldDefinition = {
  name: 'password',
  label: 'Password',
  type: 'string',
  required: true,
  sensitive: true,
};

const fieldC: FieldDefinition = {
  name: 'notes',
  label: 'Notes',
  type: 'string',
  required: false,
  sensitive: false,
};

const selectField: FieldDefinition = {
  name: 'card_network',
  label: 'Card Network',
  type: 'select',
  required: true,
  sensitive: false,
  options: ['Visa', 'Mastercard', 'Amex'],
};

/** Last `fields` array an onChange spy was called with. */
function lastFields(handleChange: ReturnType<typeof vi.fn>): FieldDefinition[] {
  const calls = handleChange.mock.calls;
  return calls[calls.length - 1][0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FieldDefinitionBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering initial fields', () => {
    it('should render a row for each field in the fields prop', () => {
      render(
        <FieldDefinitionBuilder
          fields={[fieldA, fieldB, fieldC]}
          onChange={vi.fn()}
        />,
      );

      // Each field has a Label input; three fields = three Label inputs
      const labelInputs = screen.getAllByRole('textbox', { name: /label/i });
      expect(labelInputs).toHaveLength(3);
    });

    it('should display field label values in their inputs', () => {
      render(
        <FieldDefinitionBuilder
          fields={[fieldA, fieldB]}
          onChange={vi.fn()}
        />,
      );

      const labelInputs = screen.getAllByRole('textbox', { name: /label/i });
      expect(labelInputs[0]).toHaveValue('Username');
      expect(labelInputs[1]).toHaveValue('Password');
    });

    it('should show the auto-generated name chip for fields that have a name', () => {
      render(
        <FieldDefinitionBuilder
          fields={[fieldA]}
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByText('name: username')).toBeInTheDocument();
    });

    it('should not show the name chip for fields with an empty name', () => {
      const emptyField: FieldDefinition = {
        name: '',
        label: '',
        type: 'string',
        required: false,
        sensitive: false,
      };

      render(
        <FieldDefinitionBuilder
          fields={[emptyField]}
          onChange={vi.fn()}
        />,
      );

      expect(screen.queryByText(/^name:/)).not.toBeInTheDocument();
    });

    it('should render the Fields section heading', () => {
      render(
        <FieldDefinitionBuilder
          fields={[fieldA]}
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByText('Fields')).toBeInTheDocument();
    });

    it('should render the Add Field button', () => {
      render(
        <FieldDefinitionBuilder
          fields={[fieldA]}
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByRole('button', { name: /add field/i })).toBeInTheDocument();
    });
  });

  describe('Adding a field', () => {
    it('should call onChange with a new blank field appended when Add Field is clicked', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();

      render(
        <FieldDefinitionBuilder
          fields={[fieldA]}
          onChange={handleChange}
        />,
      );

      await user.click(screen.getByRole('button', { name: /add field/i }));

      expect(handleChange).toHaveBeenCalledTimes(1);
      const updated: FieldDefinition[] = handleChange.mock.calls[0][0];
      expect(updated).toHaveLength(2);
      // New field should be blank
      expect(updated[1]).toMatchObject({
        name: '',
        label: '',
        type: 'string',
        required: false,
        sensitive: false,
      });
    });

    it('should preserve existing fields when a new field is added', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();

      render(
        <FieldDefinitionBuilder
          fields={[fieldA, fieldB]}
          onChange={handleChange}
        />,
      );

      await user.click(screen.getByRole('button', { name: /add field/i }));

      const updated: FieldDefinition[] = handleChange.mock.calls[0][0];
      expect(updated).toHaveLength(3);
      expect(updated[0]).toEqual(fieldA);
      expect(updated[1]).toEqual(fieldB);
    });
  });

  describe('Removing a field', () => {
    it('should call onChange without the removed field when delete is clicked', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();

      render(
        <FieldDefinitionBuilder
          fields={[fieldA, fieldB, fieldC]}
          onChange={handleChange}
        />,
      );

      const removeButtons = screen.getAllByRole('button', { name: /remove field/i });
      // Delete the second field (fieldB – Password)
      await user.click(removeButtons[1]);

      expect(handleChange).toHaveBeenCalledTimes(1);
      const updated: FieldDefinition[] = handleChange.mock.calls[0][0];
      expect(updated).toHaveLength(2);
      expect(updated.find((f) => f.name === 'password')).toBeUndefined();
      expect(updated.find((f) => f.name === 'username')).toBeDefined();
      expect(updated.find((f) => f.name === 'notes')).toBeDefined();
    });

    it('should disable the remove button when only one field remains', () => {
      render(
        <FieldDefinitionBuilder
          fields={[fieldA]}
          onChange={vi.fn()}
        />,
      );

      const removeButton = screen.getByRole('button', { name: /remove field/i });
      expect(removeButton).toBeDisabled();
    });

    it('should enable the remove button when multiple fields exist', () => {
      render(
        <FieldDefinitionBuilder
          fields={[fieldA, fieldB]}
          onChange={vi.fn()}
        />,
      );

      const removeButtons = screen.getAllByRole('button', { name: /remove field/i });
      removeButtons.forEach((btn) => {
        expect(btn).not.toBeDisabled();
      });
    });
  });

  describe('Auto-generating name from label', () => {
    // FieldDefinitionBuilder is a fully-controlled component: the parent owns
    // the `fields` array and the rendered inputs reflect exactly what the parent
    // passes in.  userEvent.type sends one character per event but the prop
    // never updates between keystrokes, so each event fires onChange with only
    // the single character as the new label.  We therefore use fireEvent.change
    // with the complete value to simulate a browser autofill / paste, which
    // results in a single onChange call with the full label string.

    it('should call onChange with snake_case name derived from the typed label', () => {
      const handleChange = vi.fn();

      const blankField: FieldDefinition = {
        name: '',
        label: '',
        type: 'string',
        required: false,
        sensitive: false,
      };

      render(
        <FieldDefinitionBuilder
          fields={[blankField]}
          onChange={handleChange}
        />,
      );

      const labelInput = screen.getByRole('textbox', { name: /label/i });
      fireEvent.change(labelInput, { target: { value: 'API Key' } });

      expect(handleChange).toHaveBeenCalledTimes(1);
      const updated: FieldDefinition[] = handleChange.mock.calls[0][0];
      expect(updated[0].label).toBe('API Key');
      expect(updated[0].name).toBe('api_key');
    });

    it('should generate lowercase snake_case with underscores replacing spaces', () => {
      const handleChange = vi.fn();

      const blankField: FieldDefinition = {
        name: '',
        label: '',
        type: 'string',
        required: false,
        sensitive: false,
      };

      render(
        <FieldDefinitionBuilder
          fields={[blankField]}
          onChange={handleChange}
        />,
      );

      const labelInput = screen.getByRole('textbox', { name: /label/i });
      fireEvent.change(labelInput, { target: { value: 'My Secret Token' } });

      expect(handleChange).toHaveBeenCalledTimes(1);
      const updated: FieldDefinition[] = handleChange.mock.calls[0][0];
      expect(updated[0].name).toBe('my_secret_token');
    });

    it('should generate a unique name when the derived name conflicts with an existing field', () => {
      const handleChange = vi.fn();

      // Two fields: first already named 'username', second is blank
      const existingField: FieldDefinition = {
        name: 'username',
        label: 'Username',
        type: 'string',
        required: false,
        sensitive: false,
      };
      const newField: FieldDefinition = {
        name: '',
        label: '',
        type: 'string',
        required: false,
        sensitive: false,
      };

      render(
        <FieldDefinitionBuilder
          fields={[existingField, newField]}
          onChange={handleChange}
        />,
      );

      // Change the second field's label to the same label as the first field
      const labelInputs = screen.getAllByRole('textbox', { name: /label/i });
      fireEvent.change(labelInputs[1], { target: { value: 'Username' } });

      expect(handleChange).toHaveBeenCalledTimes(1);
      const updated: FieldDefinition[] = handleChange.mock.calls[0][0];
      // The generated name for index 1 must be unique
      expect(updated[1].name).toBe('username_2');
    });

    it('should set name to empty string when label is cleared', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();

      render(
        <FieldDefinitionBuilder
          fields={[fieldA]}
          onChange={handleChange}
        />,
      );

      const labelInput = screen.getByRole('textbox', { name: /label/i });
      // Clear the existing label
      await user.clear(labelInput);

      await waitFor(() => {
        const lastCall = handleChange.mock.calls[handleChange.mock.calls.length - 1];
        const fields: FieldDefinition[] = lastCall[0];
        expect(fields[0].name).toBe('');
        expect(fields[0].label).toBe('');
      });
    });
  });

  describe('Editing field properties', () => {
    it('should call onChange when Required switch is toggled', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();

      render(
        <FieldDefinitionBuilder
          fields={[{ ...fieldA, required: false }]}
          onChange={handleChange}
        />,
      );

      const requiredSwitch = screen.getByRole('checkbox', { name: /required/i });
      await user.click(requiredSwitch);

      await waitFor(() => {
        const lastCall = handleChange.mock.calls[handleChange.mock.calls.length - 1];
        const fields: FieldDefinition[] = lastCall[0];
        expect(fields[0].required).toBe(true);
      });
    });

    it('should call onChange when Sensitive switch is toggled', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();

      render(
        <FieldDefinitionBuilder
          fields={[{ ...fieldA, sensitive: false }]}
          onChange={handleChange}
        />,
      );

      const sensitiveSwitch = screen.getByRole('checkbox', { name: /sensitive/i });
      await user.click(sensitiveSwitch);

      await waitFor(() => {
        const lastCall = handleChange.mock.calls[handleChange.mock.calls.length - 1];
        const fields: FieldDefinition[] = lastCall[0];
        expect(fields[0].sensitive).toBe(true);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Select fields (issue #33)
  // -------------------------------------------------------------------------

  describe('Authoring a select field', () => {
    it('should offer Select (list) as a selectable type', async () => {
      const user = userEvent.setup();

      render(<FieldDefinitionBuilder fields={[fieldA]} onChange={vi.fn()} />);

      await user.click(screen.getByRole('combobox', { name: /type/i }));

      const selectOption = screen.getByRole('option', { name: 'Select (list)' });
      expect(selectOption).toBeInTheDocument();
      expect(selectOption).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('should switch a field to select with an empty options list', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();

      render(<FieldDefinitionBuilder fields={[fieldA]} onChange={handleChange} />);

      await user.click(screen.getByRole('combobox', { name: /type/i }));
      await user.click(screen.getByRole('option', { name: 'Select (list)' }));

      const updated = lastFields(handleChange);
      expect(updated[0].type).toBe('select');
      expect(updated[0].options).toEqual([]);
    });

    it('should not render an options editor for non-select fields', () => {
      render(<FieldDefinitionBuilder fields={[fieldA]} onChange={vi.fn()} />);

      expect(screen.queryByRole('button', { name: /add option/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('textbox', { name: /^option /i })).not.toBeInTheDocument();
    });

    it('should load the options of an existing select field, in order', () => {
      render(<FieldDefinitionBuilder fields={[selectField]} onChange={vi.fn()} />);

      const optionInputs = screen.getAllByRole('textbox', { name: /^option \d+ for card network$/i });
      expect(optionInputs).toHaveLength(3);
      expect(optionInputs[0]).toHaveValue('Visa');
      expect(optionInputs[1]).toHaveValue('Mastercard');
      expect(optionInputs[2]).toHaveValue('Amex');
    });

    it('should append a blank option when Add Option is clicked', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();

      render(
        <FieldDefinitionBuilder
          fields={[{ ...selectField, options: ['Visa'] }]}
          onChange={handleChange}
        />,
      );

      await user.click(screen.getByRole('button', { name: /add option/i }));

      expect(lastFields(handleChange)[0].options).toEqual(['Visa', '']);
    });

    it('should call onChange with the edited option value', () => {
      const handleChange = vi.fn();

      render(
        <FieldDefinitionBuilder
          fields={[{ ...selectField, options: ['Visa', ''] }]}
          onChange={handleChange}
        />,
      );

      const optionInputs = screen.getAllByRole('textbox', { name: /^option \d+ for card network$/i });
      fireEvent.change(optionInputs[1], { target: { value: 'Discover' } });

      expect(lastFields(handleChange)[0].options).toEqual(['Visa', 'Discover']);
    });

    it('should trim an option on blur so trailing whitespace cannot fake a distinct value', () => {
      const handleChange = vi.fn();

      render(
        <FieldDefinitionBuilder
          fields={[{ ...selectField, options: ['Visa ', 'Amex'] }]}
          onChange={handleChange}
        />,
      );

      const optionInputs = screen.getAllByRole('textbox', { name: /^option \d+ for card network$/i });
      fireEvent.blur(optionInputs[0]);

      expect(lastFields(handleChange)[0].options).toEqual(['Visa', 'Amex']);
    });

    it('should remove an option', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();

      render(<FieldDefinitionBuilder fields={[selectField]} onChange={handleChange} />);

      await user.click(screen.getByRole('button', { name: 'Remove option 2' }));

      expect(lastFields(handleChange)[0].options).toEqual(['Visa', 'Amex']);
    });

    it('should allow the last remaining option to be removed', () => {
      render(
        <FieldDefinitionBuilder
          fields={[{ ...selectField, options: ['Visa'] }]}
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByRole('button', { name: 'Remove option 1' })).not.toBeDisabled();
    });
  });

  describe('Reordering select options', () => {
    it('should move an option up', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();

      render(<FieldDefinitionBuilder fields={[selectField]} onChange={handleChange} />);

      await user.click(screen.getByRole('button', { name: 'Move option 2 up' }));

      expect(lastFields(handleChange)[0].options).toEqual(['Mastercard', 'Visa', 'Amex']);
    });

    it('should move an option down', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();

      render(<FieldDefinitionBuilder fields={[selectField]} onChange={handleChange} />);

      await user.click(screen.getByRole('button', { name: 'Move option 1 down' }));

      expect(lastFields(handleChange)[0].options).toEqual(['Mastercard', 'Visa', 'Amex']);
    });

    it('should disable move-up on the first option and move-down on the last', () => {
      render(<FieldDefinitionBuilder fields={[selectField]} onChange={vi.fn()} />);

      expect(screen.getByRole('button', { name: 'Move option 1 up' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Move option 3 down' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Move option 2 up' })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: 'Move option 2 down' })).not.toBeDisabled();
    });
  });

  describe('Select option validation', () => {
    it('should flag a select field with no options', () => {
      render(
        <FieldDefinitionBuilder
          fields={[{ ...selectField, options: [] }]}
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByText('Add at least one option')).toBeInTheDocument();
    });

    it('should flag a select field whose options key is missing entirely', () => {
      const { options: _omitted, ...withoutOptions } = selectField;

      render(
        <FieldDefinitionBuilder fields={[withoutOptions]} onChange={vi.fn()} />,
      );

      expect(screen.getByText('Add at least one option')).toBeInTheDocument();
    });

    it('should flag a blank option', () => {
      render(
        <FieldDefinitionBuilder
          fields={[{ ...selectField, options: ['Visa', '  '] }]}
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByText('Option cannot be empty')).toBeInTheDocument();
    });

    it('should flag a duplicate option', () => {
      render(
        <FieldDefinitionBuilder
          fields={[{ ...selectField, options: ['Visa', 'Visa'] }]}
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByText('This option is already in the list')).toBeInTheDocument();
    });

    it('should flag an option longer than 100 characters', () => {
      render(
        <FieldDefinitionBuilder
          fields={[{ ...selectField, options: ['a'.repeat(101)] }]}
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByText('Options must be 100 characters or less')).toBeInTheDocument();
    });

    it('should flag more than 50 options', () => {
      const tooMany = Array.from({ length: 51 }, (_, i) => `Option ${i + 1}`);

      render(
        <FieldDefinitionBuilder
          fields={[{ ...selectField, options: tooMany }]}
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByText('A field can have at most 50 options')).toBeInTheDocument();
    });

    it('should disable Add Option once 50 options exist', () => {
      const full = Array.from({ length: 50 }, (_, i) => `Option ${i + 1}`);

      render(
        <FieldDefinitionBuilder
          fields={[{ ...selectField, options: full }]}
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByRole('button', { name: /add option/i })).toBeDisabled();
    });

    it('should show no option errors for a valid select field', () => {
      render(<FieldDefinitionBuilder fields={[selectField]} onChange={vi.fn()} />);

      expect(screen.queryByText('Add at least one option')).not.toBeInTheDocument();
      expect(screen.queryByText('Option cannot be empty')).not.toBeInTheDocument();
      expect(screen.queryByText('This option is already in the list')).not.toBeInTheDocument();
    });
  });

  describe('Switching a select field to another type', () => {
    it('should drop stale options when the type changes away from select', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();

      render(<FieldDefinitionBuilder fields={[selectField]} onChange={handleChange} />);

      await user.click(screen.getByRole('combobox', { name: /type/i }));
      await user.click(screen.getByRole('option', { name: 'String' }));

      const updated = lastFields(handleChange);
      expect(updated[0].type).toBe('string');
      // The API rejects `options` on non-select fields, so the key must be gone
      // entirely — not just emptied.
      expect(updated[0].options).toBeUndefined();
      expect('options' in updated[0]).toBe(false);
    });
  });

  describe('Blocking save while options are invalid', () => {
    function renderInForm(fields: FieldDefinition[], onSubmit: () => void) {
      return render(
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <FieldDefinitionBuilder fields={fields} onChange={vi.fn()} />
          <button type="submit">Save</button>
        </form>,
      );
    }

    it('should block submission of the enclosing form while a select field has no options', async () => {
      const user = userEvent.setup();
      const handleSubmit = vi.fn();

      renderInForm([{ ...selectField, options: [] }], handleSubmit);

      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(handleSubmit).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Card Network: Add at least one option',
      );
    });

    it('should block submission while an option is a duplicate', async () => {
      const user = userEvent.setup();
      const handleSubmit = vi.fn();

      renderInForm([{ ...selectField, options: ['Visa', 'Visa'] }], handleSubmit);

      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(handleSubmit).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Card Network: This option is already in the list',
      );
    });

    it('should allow submission when every select field has valid options', async () => {
      const user = userEvent.setup();
      const handleSubmit = vi.fn();

      renderInForm([fieldA, selectField], handleSubmit);

      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(handleSubmit).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('should report validity changes to the parent', () => {
      const handleValidityChange = vi.fn();

      const { rerender } = render(
        <FieldDefinitionBuilder
          fields={[{ ...selectField, options: [] }]}
          onChange={vi.fn()}
          onValidityChange={handleValidityChange}
        />,
      );

      expect(handleValidityChange).toHaveBeenLastCalledWith(false);

      rerender(
        <FieldDefinitionBuilder
          fields={[selectField]}
          onChange={vi.fn()}
          onValidityChange={handleValidityChange}
        />,
      );

      expect(handleValidityChange).toHaveBeenLastCalledWith(true);
    });
  });
});
