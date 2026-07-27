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

const selectField: FieldDefinition = {
  name: 'environment',
  label: 'Environment',
  type: 'select',
  required: false,
  sensitive: false,
  options: ['dev', 'staging', 'prod'],
};

const requiredSelectField: FieldDefinition = {
  name: 'tier',
  label: 'Tier',
  type: 'select',
  required: true,
  sensitive: false,
  options: ['gold', 'silver'],
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

  describe('Select fields', () => {
    it('should render a select control labelled with the field label', () => {
      render(
        <DynamicSecretFields
          fields={[selectField]}
          data={{}}
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByLabelText(/environment/i)).toBeInTheDocument();
    });

    it('should display the current value from the data prop', () => {
      render(
        <DynamicSecretFields
          fields={[selectField]}
          data={{ environment: 'staging' }}
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByLabelText(/environment/i)).toHaveTextContent('staging');
    });

    it('should list one option per entry in field.options', async () => {
      const user = userEvent.setup();

      render(
        <DynamicSecretFields
          fields={[requiredSelectField]}
          data={{}}
          onChange={vi.fn()}
        />,
      );

      await user.click(screen.getByLabelText(/tier/i));

      const options = await screen.findAllByRole('option');
      expect(options.map((o) => o.textContent)).toEqual(['gold', 'silver']);
    });

    it('should include an empty option for optional select fields', async () => {
      const user = userEvent.setup();

      render(
        <DynamicSecretFields
          fields={[selectField]}
          data={{}}
          onChange={vi.fn()}
        />,
      );

      await user.click(screen.getByLabelText(/environment/i));

      const options = await screen.findAllByRole('option');
      expect(options.map((o) => o.textContent)).toEqual(['None', 'dev', 'staging', 'prod']);
    });

    it('should call onChange with the chosen option', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();

      render(
        <DynamicSecretFields
          fields={[selectField]}
          data={{ environment: 'dev' }}
          onChange={handleChange}
        />,
      );

      await user.click(screen.getByLabelText(/environment/i));
      await user.click(await screen.findByRole('option', { name: 'prod' }));

      await waitFor(() => {
        expect(handleChange).toHaveBeenCalledWith(
          expect.objectContaining({ environment: 'prod' }),
        );
      });
    });

    it('should allow clearing an optional select via the empty option', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();

      render(
        <DynamicSecretFields
          fields={[selectField]}
          data={{ environment: 'dev' }}
          onChange={handleChange}
        />,
      );

      await user.click(screen.getByLabelText(/environment/i));
      await user.click(await screen.findByRole('option', { name: 'None' }));

      await waitFor(() => {
        expect(handleChange).toHaveBeenCalledWith(
          expect.objectContaining({ environment: '' }),
        );
      });
    });

    it('should preserve other data values when a select changes', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();

      render(
        <DynamicSecretFields
          fields={[textField, selectField]}
          data={{ username: 'alice', environment: 'dev' }}
          onChange={handleChange}
        />,
      );

      await user.click(screen.getByLabelText(/environment/i));
      await user.click(await screen.findByRole('option', { name: 'staging' }));

      await waitFor(() => {
        expect(handleChange).toHaveBeenCalledWith({
          username: 'alice',
          environment: 'staging',
        });
      });
    });

    it('should render a disabled control when options are undefined', () => {
      const noOptions: FieldDefinition = {
        name: 'environment',
        label: 'Environment',
        type: 'select',
        required: false,
        sensitive: false,
      };

      render(
        <DynamicSecretFields
          fields={[noOptions]}
          data={{}}
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByLabelText(/environment/i)).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByText(/no options are configured/i)).toBeInTheDocument();
    });

    it('should render a disabled control when options are empty', () => {
      render(
        <DynamicSecretFields
          fields={[{ ...selectField, options: [] }]}
          data={{}}
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByLabelText(/environment/i)).toHaveAttribute('aria-disabled', 'true');
    });

    it('should keep a stored value that is no longer among the options selectable', async () => {
      const user = userEvent.setup();

      render(
        <DynamicSecretFields
          fields={[selectField]}
          data={{ environment: 'legacy' }}
          onChange={vi.fn()}
        />,
      );

      const control = screen.getByLabelText(/environment/i);
      expect(control).toHaveTextContent('legacy');

      await user.click(control);
      const options = await screen.findAllByRole('option');
      expect(options.map((o) => o.textContent)).toContain('legacy');
    });

    it('should display error helper text for select fields', () => {
      render(
        <DynamicSecretFields
          fields={[requiredSelectField]}
          data={{}}
          onChange={vi.fn()}
          errors={{ tier: 'Tier is required' }}
        />,
      );

      expect(screen.getByText('Tier is required')).toBeInTheDocument();
    });

    it('should render the select value as plain text in read-only mode', () => {
      render(
        <DynamicSecretFields
          fields={[selectField]}
          data={{ environment: 'prod' }}
          onChange={vi.fn()}
          readOnly
        />,
      );

      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(screen.getByText('prod')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /copy to clipboard/i })).toBeInTheDocument();
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
