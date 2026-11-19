// Issue #211: the document review form — AI and Check chips, the kind guess,
// the checks and warnings alert, low-confidence attribute rows. Invented values.
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';

import { render } from '../utils/test-utils.js';
import { DocumentReviewForm } from '../../src/documents/ui/components/DocumentReviewForm.js';
import { toDocumentReviewValues } from '../../src/documents/headless/useDocumentScan.js';
import { ID_DOCUMENT_TYPE, ID_EXTRACTION, PASSPORT_EXTRACTION, PASSPORT_TYPE } from './documentFixtures.js';

function renderIdForm(overrides: Partial<Parameters<typeof DocumentReviewForm>[0]> = {}) {
  const seed = toDocumentReviewValues(ID_EXTRACTION);
  return render(
    <DocumentReviewForm
      fields={ID_DOCUMENT_TYPE.fields}
      values={seed.values}
      onChange={vi.fn()}
      aiFields={new Set(['holder_name', 'document_number', 'document_kind', 'expiry_date'])}
      lowConfidenceFields={new Set(['document_number'])}
      kindConfidence={0.92}
      flaggedAttributes={new Set(['restrictions'])}
      warnings={ID_EXTRACTION.warnings}
      {...overrides}
    />,
  );
}

describe('DocumentReviewForm', () => {
  it('marks AI values, and Check instead of AI on a low-confidence one', () => {
    renderIdForm();
    const holder = screen.getByTestId('review-field-holder_name');
    expect(within(holder).getByLabelText('Holder Name read by AI')).toBeInTheDocument();
    const number = screen.getByTestId('review-field-document_number');
    expect(within(number).getByLabelText('Check Document Number')).toBeInTheDocument();
    expect(within(number).queryByLabelText('Document Number read by AI')).not.toBeInTheDocument();
    expect(within(number).getByText(/hard to read here/)).toBeInTheDocument();
    // Empty or untouched-by-AI fields carry no chip.
    expect(within(screen.getByTestId('review-field-notes')).queryByText('AI')).not.toBeInTheDocument();
  });

  it('shows the kind guess with its confidence', () => {
    renderIdForm();
    const kind = screen.getByTestId('review-field-document_kind');
    expect(within(kind).getByText('AI guessed · 92%')).toBeInTheDocument();
  });

  it('drops the kind chip once the kind is no longer the AI guess', () => {
    renderIdForm({ aiFields: new Set(['holder_name']) });
    expect(screen.queryByText(/AI guessed/)).not.toBeInTheDocument();
  });

  it('outlines the low-confidence attribute rows only', () => {
    renderIdForm();
    expect(screen.getByTestId('keyvalue-row-1')).toHaveAttribute('data-flagged', 'true');
    expect(screen.getByTestId('keyvalue-row-0')).not.toHaveAttribute('data-flagged');
    expect(screen.getByLabelText('Check Restrictions: hard to read')).toBeInTheDocument();
  });

  it('lists failed checks and warnings in one alert', () => {
    const seed = toDocumentReviewValues(PASSPORT_EXTRACTION);
    render(
      <DocumentReviewForm
        fields={PASSPORT_TYPE.fields}
        values={seed.values}
        onChange={vi.fn()}
        checks={[...PASSPORT_EXTRACTION.checks, { id: 'ssn', ok: true, failed: [] }]}
        warnings={['The photo was dark.']}
      />,
    );
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(within(alerts[0]).getByText('Check these before saving')).toBeInTheDocument();
    expect(within(alerts[0]).getByText(/machine readable zone did not pass .*\(Passport Number\)/)).toBeInTheDocument();
    expect(within(alerts[0]).getByText('The photo was dark.')).toBeInTheDocument();
    expect(within(alerts[0]).queryByText(/Social Security/)).not.toBeInTheDocument();
  });

  it('shows no alert when every check passed and nothing was warned', () => {
    renderIdForm({ warnings: [], checks: [{ id: 'mrz', ok: true, failed: [] }] });
    expect(screen.queryByText('Check these before saving')).not.toBeInTheDocument();
  });
});
