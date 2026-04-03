import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import { DynamicSecretFields } from '../../../components/secrets/DynamicSecretFields';
import type { FieldDefinition } from '../../../types';

const textField: FieldDefinition = {
  name: 'username',
  label: 'Username',
  type: 'string',
  required: true,
  sensitive: false,
};

const sensitiveField: FieldDefinition = {
  name: 'password',
  label: 'Password',
  type: 'string',
  required: true,
  sensitive: true,
};

const optionalTextField: FieldDefinition = {
  name: 'notes',
  label: 'Notes',
  type: 'string',
  required: false,
  sensitive: false,
};

const numberField: FieldDefinition = {
  name: 'port',
  label: 'Port',
  type: 'number',
  required: false,
  sensitive: false,
};

const dateField: FieldDefinition = {
  name: 'expires_on',
  label: 'Expires On',
  type: 'date',
  required: false,
  sensitive: false,
};

describe('DynamicSecretFields', () => {
  describe('Rendering fields from definitions', () => {
    it('should render a text input for a non-sensitive string field', () => {
      render(
        <DynamicSecretFields
          fields={[textField]}
          data={{}}
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    });

    it('should render all provided fields', () => {
      render(
        <DynamicSecretFields
          fields={[textField, optionalTextField, numberField]}
          data={{}}
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
      // notes field renders as multiline – find by label text
      expect(screen.getByLabelText(/notes/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/port/i)).toBeInTheDocument();
    });

    it('should render a number input for a number field', () => {
      render(
        <DynamicSecretFields
          fields={[numberField]}
          data={{}}
          onChange={vi.fn()}
        />,
      );

      const input = screen.getByLabelText(/port/i);
      expect(input).toHaveAttribute('type', 'number');
    });

    it('should render a date input for a date field', () => {
      render(
        <DynamicSecretFields
          fields={[dateField]}
          data={{}}
          onChange={vi.fn()}
        />,
      );

      const input = screen.getByLabelText(/expires on/i);
      expect(input).toHaveAttribute('type', 'date');
    });

    it('should pre-populate inputs with values from data prop', () => {
      render(
        <DynamicSecretFields
          fields={[textField]}
          data={{ username: 'alice' }}
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByLabelText(/username/i)).toHaveValue('alice');
    });

    it('should display error helper text when errors are provided', () => {
      render(
        <DynamicSecretFields
          fields={[textField]}
          data={{}}
          onChange={vi.fn()}
          errors={{ username: 'Username is required' }}
        />,
      );

      expect(screen.getByText('Username is required')).toBeInTheDocument();
    });
  });

  describe('Sensitive fields', () => {
    it('should render password-type input for sensitive fields', () => {
      render(
        <DynamicSecretFields
          fields={[sensitiveField]}
          data={{}}
          onChange={vi.fn()}
        />,
      );

      const input = screen.getByLabelText(/password/i);
      expect(input).toHaveAttribute('type', 'password');
    });

    it('should render an eye icon button for sensitive fields', () => {
      render(
        <DynamicSecretFields
          fields={[sensitiveField]}
          data={{}}
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByRole('button', { name: /show field/i })).toBeInTheDocument();
    });

    it('should toggle sensitive field to visible when eye icon is clicked', async () => {
      const user = userEvent.setup();

      render(
        <DynamicSecretFields
          fields={[sensitiveField]}
          data={{ password: 'secret123' }}
          onChange={vi.fn()}
        />,
      );

      const input = screen.getByLabelText(/password/i);
      expect(input).toHaveAttribute('type', 'password');

      const showButton = screen.getByRole('button', { name: /show field/i });
      await user.click(showButton);

      await waitFor(() => {
        expect(screen.getByLabelText(/password/i)).toHaveAttribute('type', 'text');
      });
    });

    it('should show a hide button after sensitive field is revealed', async () => {
      const user = userEvent.setup();

      render(
        <DynamicSecretFields
          fields={[sensitiveField]}
          data={{ password: 'secret123' }}
          onChange={vi.fn()}
        />,
      );

      await user.click(screen.getByRole('button', { name: /show field/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /hide field/i })).toBeInTheDocument();
      });
    });

    it('should toggle sensitive field back to hidden when hide icon is clicked', async () => {
      const user = userEvent.setup();

      render(
        <DynamicSecretFields
          fields={[sensitiveField]}
          data={{ password: 'secret123' }}
          onChange={vi.fn()}
        />,
      );

      // Reveal
      await user.click(screen.getByRole('button', { name: /show field/i }));
      await waitFor(() => {
        expect(screen.getByLabelText(/password/i)).toHaveAttribute('type', 'text');
      });

      // Hide again
      await user.click(screen.getByRole('button', { name: /hide field/i }));
      await waitFor(() => {
        expect(screen.getByLabelText(/password/i)).toHaveAttribute('type', 'password');
      });
    });
  });

  describe('Required fields', () => {
    it('should set required attribute on required field inputs', () => {
      render(
        <DynamicSecretFields
          fields={[textField]}
          data={{}}
          onChange={vi.fn()}
        />,
      );

      // MUI marks the underlying input as required
      const input = screen.getByLabelText(/username/i);
      expect(input).toBeRequired();
    });

    it('should not set required attribute on optional field inputs', () => {
      render(
        <DynamicSecretFields
          fields={[optionalTextField]}
          data={{}}
          onChange={vi.fn()}
        />,
      );

      const input = screen.getByLabelText(/notes/i);
      expect(input).not.toBeRequired();
    });
  });

  describe('Read-only mode', () => {
    it('should render Typography instead of inputs when readOnly is true', () => {
      render(
        <DynamicSecretFields
          fields={[textField]}
          data={{ username: 'alice' }}
          onChange={vi.fn()}
          readOnly
        />,
      );

      // No text input should be rendered
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      // Value should appear as plain text
      expect(screen.getByText('alice')).toBeInTheDocument();
    });

    it('should display the field label as a caption in read-only mode', () => {
      render(
        <DynamicSecretFields
          fields={[textField]}
          data={{ username: 'alice' }}
          onChange={vi.fn()}
          readOnly
        />,
      );

      expect(screen.getByText(/username/i)).toBeInTheDocument();
    });

    it('should show a dash for empty values in read-only mode', () => {
      render(
        <DynamicSecretFields
          fields={[optionalTextField]}
          data={{}}
          onChange={vi.fn()}
          readOnly
        />,
      );

      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('should render SensitiveDisplay (masked chip) for sensitive fields in read-only mode', () => {
      render(
        <DynamicSecretFields
          fields={[sensitiveField]}
          data={{ password: 'secret123' }}
          onChange={vi.fn()}
          readOnly
        />,
      );

      // The masked representation uses bullet characters
      expect(screen.getByText('••••••••')).toBeInTheDocument();
    });

    it('should reveal sensitive value when mask chip is clicked in read-only mode', async () => {
      const user = userEvent.setup();

      render(
        <DynamicSecretFields
          fields={[sensitiveField]}
          data={{ password: 'secret123' }}
          onChange={vi.fn()}
          readOnly
        />,
      );

      const maskChip = screen.getByText('••••••••');
      await user.click(maskChip);

      await waitFor(() => {
        expect(screen.getByText('secret123')).toBeInTheDocument();
      });
    });
  });

  describe('onChange callback', () => {
    it('should call onChange with updated data when a field value changes', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();

      render(
        <DynamicSecretFields
          fields={[textField]}
          data={{ username: '' }}
          onChange={handleChange}
        />,
      );

      const input = screen.getByLabelText(/username/i);
      await user.type(input, 'bob');

      await waitFor(() => {
        // Each keystroke fires onChange; check the last call contains the typed char
        expect(handleChange).toHaveBeenCalled();
        const lastCall = handleChange.mock.calls[handleChange.mock.calls.length - 1][0];
        expect(lastCall).toMatchObject({ username: expect.stringContaining('b') });
      });
    });

    it('should preserve existing data fields when one field changes', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();

      render(
        <DynamicSecretFields
          fields={[textField, numberField]}
          data={{ username: 'alice', port: '5432' }}
          onChange={handleChange}
        />,
      );

      const usernameInput = screen.getByLabelText(/username/i);
      // Clear existing value and type a new one
      fireEvent.change(usernameInput, { target: { value: 'bob' } });

      await waitFor(() => {
        expect(handleChange).toHaveBeenCalledWith(
          expect.objectContaining({ username: 'bob', port: '5432' }),
        );
      });
    });

    it('should call onChange with updated data when sensitive field value changes', async () => {
      const handleChange = vi.fn();

      render(
        <DynamicSecretFields
          fields={[sensitiveField]}
          data={{ password: '' }}
          onChange={handleChange}
        />,
      );

      const input = screen.getByLabelText(/password/i);
      fireEvent.change(input, { target: { value: 'newpassword' } });

      await waitFor(() => {
        expect(handleChange).toHaveBeenCalledWith(
          expect.objectContaining({ password: 'newpassword' }),
        );
      });
    });
  });
});
