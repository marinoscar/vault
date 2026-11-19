// Issue #209: the Passport and ID Document system types in the secret form. Invented values only.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render as rtlRender, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ID_DOCUMENT_KIND_CATALOG, ID_DOCUMENT_KINDS } from '@marinoscar/vault-contract/secret-types';
import { render } from '../utils/test-utils.js';
import type { FieldDefinition, SecretType } from '../../src/core/headless/types.js';
import {
  documentScanPath,
  documentScanTypeParam,
  keyValueSuggestionsFor,
} from '../../src/secrets/headless/secretFields.js';

const aiStatus = vi.hoisted(() => ({ documentScanEnabled: false }));
const dynamicFieldsProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('../../src/core/headless/useAiStatus.js', () => ({
  useAiStatus: () => ({
    config: { enabled: false, providers: [] },
    isLoading: false,
    error: null,
    cardExtractEnabled: false,
    documentScanEnabled: aiStatus.documentScanEnabled,
    canUseAi: true,
    refresh: async () => undefined,
  }),
}));

vi.mock('../../src/secrets/ui/components/DynamicSecretFields.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/secrets/ui/components/DynamicSecretFields.js')>();
  return {
    ...actual,
    DynamicSecretFields: (props: Parameters<typeof actual.DynamicSecretFields>[0]) => {
      dynamicFieldsProps.push(props as unknown as Record<string, unknown>);
      return actual.DynamicSecretFields(props);
    },
  };
});

// Imported after the mocks.
const { SecretForm } = await import('../../src/secrets/ui/components/SecretForm.js');
const { SecretTypeIcon } = await import('../../src/secrets/ui/components/SecretTypeIcon.js');

const PASSPORT: SecretType = {
  id: 'type-passport', name: 'Passport', description: 'Passport details and data page photo', icon: 'TravelExplore',
  isSystem: true, allowAttachments: true, createdAt: '2026-01-01T00:00:00Z',
  fields: [
    { name: 'surname', label: 'Surname', type: 'string', required: true, sensitive: false },
    { name: 'passport_number', label: 'Passport Number', type: 'string', required: true, sensitive: true },
  ],
};
const ID_DOCUMENT: SecretType = {
  id: 'type-id-document', name: 'ID Document', description: null, icon: 'AssignmentInd',
  isSystem: true, allowAttachments: true, createdAt: '2026-01-01T00:00:00Z',
  fields: [
    { name: 'document_kind', label: 'Document Kind', type: 'select', required: true, sensitive: false, options: [...ID_DOCUMENT_KINDS] },
    { name: 'holder_name', label: 'Holder Name', type: 'string', required: true, sensitive: false },
    // The web field model learns `keyvalue` in IDOC-4 (#207); the API already serves it.
    { name: 'attributes', label: 'Details', type: 'keyvalue', required: false, sensitive: false } as unknown as FieldDefinition,
  ],
};
const CUSTOM_ID: SecretType = { ...ID_DOCUMENT, id: 'type-custom', isSystem: false };

function renderForm() {
  render(
    <SecretForm
      mode="create"
      types={[PASSPORT, ID_DOCUMENT]}
      submitLabel="Create secret"
      submittingLabel="Creating…"
      onSubmit={vi.fn().mockResolvedValue(undefined)}
      onCancel={vi.fn()}
    />,
  );
}

async function pickOption(user: ReturnType<typeof userEvent.setup>, label: RegExp, name: string) {
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(within(await screen.findByRole('listbox')).getByRole('option', { name }));
}

beforeEach(() => {
  aiStatus.documentScanEnabled = false;
  dynamicFieldsProps.length = 0;
});

describe('identity document helpers', () => {
  it('maps the system Passport and ID Document to the scan type, nothing else', () => {
    expect(documentScanTypeParam(PASSPORT)).toBe('passport');
    expect(documentScanTypeParam(ID_DOCUMENT)).toBe('id_document');
    expect(documentScanTypeParam(CUSTOM_ID)).toBeNull();
    expect(documentScanTypeParam({ isSystem: true, name: 'Card' })).toBeNull();
    expect(documentScanTypeParam(null)).toBeNull();
    expect(documentScanPath('id_document')).toBe('/documents/scan?type=id_document');
  });

  it('suggests the standard keys of the chosen kind for attributes, only on the system ID Document', () => {
    expect(keyValueSuggestionsFor(ID_DOCUMENT, {})).toEqual({});
    expect(keyValueSuggestionsFor(ID_DOCUMENT, { document_kind: 'Driver License' })).toEqual({
      attributes: ID_DOCUMENT_KIND_CATALOG['Driver License'].standardKeys,
    });
    expect(keyValueSuggestionsFor(ID_DOCUMENT, { document_kind: 'Social Security Card' })).toEqual({});
    expect(keyValueSuggestionsFor(ID_DOCUMENT, { document_kind: 'Library Card' })).toEqual({});
    expect(keyValueSuggestionsFor(CUSTOM_ID, { document_kind: 'Driver License' })).toEqual({});
    expect(keyValueSuggestionsFor(PASSPORT, { document_kind: 'Driver License' })).toEqual({});
  });
});

describe('SecretTypeIcon', () => {
  it.each([
    ['TravelExplore', 'TravelExploreIcon'],
    ['AssignmentInd', 'AssignmentIndIcon'],
    ['Badge', 'BadgeIcon'],
  ])('renders the %s icon', (icon, testId) => {
    rtlRender(<SecretTypeIcon icon={icon} />);
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });
});

describe('SecretForm with the identity document types', () => {
  it('hides the scan hint while documentScanEnabled is false', async () => {
    const user = userEvent.setup();
    renderForm();
    await pickOption(user, /Type/, 'Passport');
    expect(screen.getByLabelText(/Surname/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Scan it instead' })).not.toBeInTheDocument();
  });

  it.each([
    ['Passport', '/documents/scan?type=passport'],
    ['ID Document', '/documents/scan?type=id_document'],
  ])('links a %s to the document scan once it is enabled', async (name, href) => {
    aiStatus.documentScanEnabled = true;
    const user = userEvent.setup();
    renderForm();
    expect(screen.queryByRole('link', { name: 'Scan it instead' })).not.toBeInTheDocument();
    await pickOption(user, /Type/, name);
    expect(screen.getByRole('link', { name: 'Scan it instead' })).toHaveAttribute('href', href);
  });

  it('hands the attributes editor the standard keys of the chosen kind', async () => {
    const user = userEvent.setup();
    renderForm();
    await pickOption(user, /Type/, 'ID Document');
    expect(dynamicFieldsProps.at(-1)!.suggestions).toEqual({});

    await pickOption(user, /Document Kind/, 'Trusted Traveler Card');
    expect(dynamicFieldsProps.at(-1)!.suggestions).toEqual({
      attributes: ID_DOCUMENT_KIND_CATALOG['Trusted Traveler Card'].standardKeys,
    });

    await pickOption(user, /Document Kind/, 'Vehicle Registration');
    const keys = (dynamicFieldsProps.at(-1)!.suggestions as { attributes: Array<{ key: string }> }).attributes.map((k) => k.key);
    expect(keys).toEqual(['vin', 'plate', 'make', 'model', 'year', 'registered_owner']);
  });
});
