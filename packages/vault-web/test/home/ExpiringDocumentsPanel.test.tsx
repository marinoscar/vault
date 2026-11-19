import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DocumentSummaryItem } from '@marinoscar/vault-contract/secrets';
import { render } from '../utils/test-utils.js';
import {
  ExpiringDocumentsPanel,
  EXPIRING_DOCUMENTS_LIMIT,
  documentMetaLine,
} from '../../src/home/ui/components/ExpiringDocumentsPanel.js';

const doc = (id: string, over: Partial<DocumentSummaryItem> = {}): DocumentSummaryItem => ({
  id,
  name: `Document ${id}`,
  typeName: 'ID Document',
  documentKind: 'Visa',
  expiryDate: '2027-01-15',
  status: 'expiring_soon',
  ...over,
});

describe('ExpiringDocumentsPanel (IDOC-9)', () => {
  it('renders nothing when no document needs attention', () => {
    const { container } = render(
      <ExpiringDocumentsPanel
        status="ready"
        documents={[doc('a', { status: 'valid' }), doc('b', { status: 'no_expiry', expiryDate: null })]}
        error={null}
        onRetry={() => undefined}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while loading or with no documents', () => {
    const loading = render(<ExpiringDocumentsPanel status="loading" documents={[]} error={null} onRetry={() => undefined} />);
    expect(loading.container).toBeEmptyDOMElement();
    loading.unmount();
    const empty = render(<ExpiringDocumentsPanel status="ready" documents={[]} error={null} onRetry={() => undefined} />);
    expect(empty.container).toBeEmptyDOMElement();
  });

  it('lists expired and expiring documents with their badge, each linking to the secret', () => {
    render(
      <ExpiringDocumentsPanel
        status="ready"
        documents={[
          doc('p1', { name: 'Passport A', typeName: 'Passport', documentKind: null, status: 'expired', expiryDate: '2026-10-01' }),
          doc('v1', { name: 'Visa A' }),
          doc('ok', { name: 'Fine', status: 'valid' }),
        ]}
        error={null}
        onRetry={() => undefined}
      />,
    );
    const list = screen.getByRole('list', { name: 'Documents needing attention' });
    const links = within(list).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/secrets/p1', '/secrets/v1']);
    expect(within(list).getByText('Passport · Exp 2026-10-01')).toBeInTheDocument();
    expect(within(list).getByLabelText('Expired, expiry 2026-10-01')).toBeInTheDocument();
    expect(screen.queryByText('Fine')).not.toBeInTheDocument();
  });

  it(`shows at most ${EXPIRING_DOCUMENTS_LIMIT} rows and counts the rest`, () => {
    const many = Array.from({ length: EXPIRING_DOCUMENTS_LIMIT + 2 }, (_, i) => doc(`d${i}`));
    render(<ExpiringDocumentsPanel status="ready" documents={many} error={null} onRetry={() => undefined} />);
    expect(screen.getAllByRole('link')).toHaveLength(EXPIRING_DOCUMENTS_LIMIT);
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });

  it('shows an error with a retry', async () => {
    const onRetry = vi.fn();
    render(<ExpiringDocumentsPanel status="error" documents={[]} error="Documents are down" onRetry={onRetry} />);
    expect(screen.getByText('Documents are down')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('builds the meta line from the kind and the expiry only', () => {
    expect(documentMetaLine({ typeName: 'ID Document', documentKind: null, expiryDate: null })).toBe('ID Document · Exp —');
  });
});
