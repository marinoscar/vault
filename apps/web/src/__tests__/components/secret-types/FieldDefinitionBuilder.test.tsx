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
});
