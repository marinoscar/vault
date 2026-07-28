import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { render } from '../../utils/test-utils';
import { CardReviewForm } from '../../../components/cards/CardReviewForm';
import type { FieldDefinition } from '../../../types';

const CVV_FIELD: FieldDefinition = {
  name: 'cvv',
  label: 'CVV / CVC',
  type: 'string',
  required: true,
  sensitive: true,
};

const NAME_FIELD: FieldDefinition = {
  name: 'cardholder_name',
  label: 'Cardholder Name',
  type: 'string',
  required: true,
  sensitive: false,
};

/** Wraps the form with local state so typing into a field is observable. */
function ControlledForm(props: {
  values: Record<string, string>;
  fields?: FieldDefinition[];
  lowConfidenceFields?: Set<string>;
}) {
  const [values, setValues] = useState(props.values);
  return (
    <CardReviewForm
      fields={props.fields ?? [CVV_FIELD]}
      values={values}
      onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
      lowConfidenceFields={props.lowConfidenceFields}
    />
  );
}

describe('CardReviewForm — CVV helper text', () => {
  it('shows the empty-state helper when the CVV was not read from the photo', () => {
    render(<ControlledForm values={{ cvv: '' }} />);

    expect(
      screen.getByText(/not read from the photo — type it from the card\. required\./i),
    ).toBeInTheDocument();
  });

  it('shows the read-state helper once a value is present', () => {
    render(<ControlledForm values={{ cvv: '123' }} />);

    expect(
      screen.getByText(/read from the photo — check it against the card\./i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/type it from the card/i)).not.toBeInTheDocument();
  });

  it('switches from the empty helper to the read helper as the user types', async () => {
    const user = userEvent.setup();
    render(<ControlledForm values={{ cvv: '' }} />);

    expect(screen.getByText(/type it from the card/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^cvv \/ cvc \*?$/i), '123');

    expect(
      await screen.findByText(/read from the photo — check it against the card\./i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/type it from the card/i)).not.toBeInTheDocument();
  });

  it('lets the empty helper regress back in if the value is cleared again', async () => {
    const user = userEvent.setup();
    render(<ControlledForm values={{ cvv: '123' }} />);

    expect(screen.getByText(/read from the photo/i)).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/^cvv \/ cvc \*?$/i));

    expect(
      await screen.findByText(/not read from the photo — type it from the card\. required\./i),
    ).toBeInTheDocument();
  });

  it('prioritises the empty-CVV helper over a low-confidence flag', () => {
    render(
      <ControlledForm values={{ cvv: '' }} lowConfidenceFields={new Set(['cvv'])} />,
    );

    // Empty + low-confidence still means "nothing to check" - the actionable
    // "type it" message must win over "check this against the card".
    expect(screen.getByText(/type it from the card/i)).toBeInTheDocument();
    expect(screen.queryByText(/hard to read here/i)).not.toBeInTheDocument();
  });

  it('shows the low-confidence helper on a non-CVV field instead of the CVV copy', () => {
    render(
      <ControlledForm
        values={{ cardholder_name: 'ADA LOVELACE' }}
        fields={[NAME_FIELD]}
        lowConfidenceFields={new Set(['cardholder_name'])}
      />,
    );

    expect(screen.getByText(/hard to read here/i)).toBeInTheDocument();
    expect(screen.queryByText(/read from the photo — check it against the card\./i)).not.toBeInTheDocument();
  });
});
