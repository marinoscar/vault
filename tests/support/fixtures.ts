/**
 * Invented fixtures for the visual and e2e suites (E10.7, #98).
 *
 * Everything here is made up: people are `Person A`, the organization is
 * `Org Alpha`, addresses end in `@example.test`, card numbers are the
 * well-known test PANs. Nothing is a real credential. Both suites answer the
 * API from these objects, so a screenshot or an assertion never depends on a
 * database, a clock or a model.
 */

/** The frozen "now" of every page (the clock is fixed to it in `stabilize.ts`). */
export const FROZEN_NOW = '2026-06-15T12:00:00.000Z';

export const ACCESS_TOKEN = 'e2e-access-token-not-a-real-token';

/** Every permission the signed-in administrator holds (the Console shows every card). */
export const ADMIN_PERMISSIONS = [
  'user_settings:read',
  'user_settings:write',
  'secrets:read',
  'secrets:write',
  'secrets:delete',
  'secret_types:read',
  'secret_types:write',
  'media:read',
  'media:write',
  'ai:use',
  'ai_config:read',
  'ai_config:write',
  'system_settings:read',
  'system_settings:write',
  'users:read',
  'users:write',
  'allowlist:read',
  'allowlist:write',
  'push:read',
  'push:write',
  'broadcasts:read',
  'broadcasts:write',
  'db_backup:read',
  'db_backup:write',
  'storage_config:read',
  'storage_config:write',
  'rbac:manage',
];

/** What a contributor holds: the library, no Console. */
export const MEMBER_PERMISSIONS = [
  'user_settings:read',
  'user_settings:write',
  'secrets:read',
  'secrets:write',
  'secrets:delete',
  'secret_types:read',
  'media:read',
  'media:write',
  'ai:use',
];

export function makeUser(role: 'admin' | 'contributor' = 'admin') {
  return {
    id: 'user-person-a',
    email: 'person.a@example.test',
    displayName: 'Person A',
    profileImageUrl: null,
    providerProfileImageUrl: null,
    hasUploadedProfileImage: false,
    roles: [{ name: role }],
    permissions: role === 'admin' ? ADMIN_PERMISSIONS : MEMBER_PERMISSIONS,
    isActive: true,
    createdAt: '2026-01-05T09:00:00.000Z',
    tenancyMode: 'single',
    activeOrg: null,
    memberships: [],
  };
}

const field = (
  name: string,
  label: string,
  required: boolean,
  sensitive: boolean,
  extra: Record<string, unknown> = {},
) => ({ name, label, type: 'string', required, sensitive, ...extra });

const systemType = (
  id: string,
  name: string,
  description: string,
  icon: string,
  fields: unknown[],
  allowAttachments = false,
) => ({
  id,
  name,
  description,
  icon,
  fields,
  allowAttachments,
  isSystem: true,
  createdAt: '2026-01-01T00:00:00.000Z',
});

export const TYPE_CREDENTIAL = systemType(
  'type-credential',
  'Credential',
  'Username and password credentials',
  'Key',
  [
    field('username', 'Username', true, false),
    field('password', 'Password', true, true),
    field('url', 'URL', false, false),
    field('notes', 'Notes', false, false),
  ],
);

export const TYPE_API_KEY = systemType('type-api-key', 'API Key', 'API keys and access tokens', 'VpnKey', [
  field('key', 'API Key', true, true),
  field('provider', 'Provider', false, false),
  field('notes', 'Notes', false, false),
]);

export const TYPE_CARD = systemType(
  'type-card',
  'Card',
  'Credit or debit card information',
  'CreditCard',
  [
    field('card_network', 'Card Company / Network', false, false, {
      type: 'select',
      options: ['Visa', 'Mastercard', 'American Express', 'Discover', 'Other'],
    }),
    field('card_kind', 'Card Type', false, false, { type: 'select', options: ['Credit', 'Debit'] }),
    field('cardholder_name', 'Cardholder Name', true, false),
    field('number', 'Card Number', true, true),
    field('exp_month', 'Expiration Month', true, false),
    field('exp_year', 'Expiration Year', true, false),
    field('cvv', 'CVV / CVC', true, true),
    field('security_code_2', 'Secondary Security Code (CID / control number)', false, true),
    field('issuing_bank', 'Issuing Bank', false, false),
    field('notes', 'Notes', false, false),
  ],
  true,
);

export const TYPE_TOKEN = systemType('type-token', 'Token', 'Authentication tokens', 'Token', [
  field('token', 'Token', true, true),
  field('provider', 'Provider', false, false),
  field('notes', 'Notes', false, false),
]);

export const TYPE_NOTE = systemType('type-note', 'Note', 'Secure notes', 'Description', [
  field('content', 'Content', true, false),
]);

export const TYPE_DOCUMENT = systemType(
  'type-document',
  'Document',
  'Documents with file attachments',
  'AttachFile',
  [field('title', 'Title', true, false), field('notes', 'Notes', false, false)],
  true,
);

export const SECRET_TYPES = [TYPE_CREDENTIAL, TYPE_API_KEY, TYPE_CARD, TYPE_TOKEN, TYPE_NOTE, TYPE_DOCUMENT];

export interface FixtureSecret {
  id: string;
  name: string;
  description: string | null;
  type: (typeof SECRET_TYPES)[number];
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  values: Record<string, unknown>;
}

export const SECRETS: FixtureSecret[] = [
  {
    id: 'secret-alpha-portal',
    name: 'Org Alpha portal',
    description: 'Shared sign-in for the Org Alpha partner portal',
    type: TYPE_CREDENTIAL,
    currentVersion: 3,
    createdAt: '2026-02-03T10:00:00.000Z',
    updatedAt: '2026-06-14T16:30:00.000Z',
    values: {
      username: 'person.a@example.test',
      password: 'example-password-not-real-1',
      url: 'https://portal.example.test',
      notes: 'Rotate every quarter.',
    },
  },
  {
    id: 'secret-product-x-key',
    name: 'Product X API key',
    description: null,
    type: TYPE_API_KEY,
    currentVersion: 1,
    createdAt: '2026-03-12T08:15:00.000Z',
    updatedAt: '2026-06-10T09:00:00.000Z',
    values: { key: 'pk_test_0000000000000000', provider: 'Product X', notes: '' },
  },
  {
    id: 'secret-card-visa',
    name: 'Visa ending 1111',
    description: 'Travel card',
    type: TYPE_CARD,
    currentVersion: 1,
    createdAt: '2026-01-20T11:00:00.000Z',
    updatedAt: '2026-06-01T11:00:00.000Z',
    values: {
      card_network: 'Visa',
      card_kind: 'Credit',
      cardholder_name: 'PERSON A',
      number: '4111111111111111',
      exp_month: '07',
      exp_year: '2026',
      cvv: '123',
      issuing_bank: 'Bank Alpha',
    },
  },
  {
    id: 'secret-card-mc',
    name: 'Mastercard ending 4444',
    description: 'Expired',
    type: TYPE_CARD,
    currentVersion: 2,
    createdAt: '2025-05-02T11:00:00.000Z',
    updatedAt: '2026-05-20T11:00:00.000Z',
    values: {
      card_network: 'Mastercard',
      card_kind: 'Debit',
      cardholder_name: 'PERSON A',
      number: '5555555555554444',
      exp_month: '05',
      exp_year: '2026',
      cvv: '456',
      issuing_bank: 'Bank Beta',
    },
  },
  {
    id: 'secret-card-amex',
    name: 'Amex ending 8431',
    description: null,
    type: TYPE_CARD,
    currentVersion: 1,
    createdAt: '2026-04-02T11:00:00.000Z',
    updatedAt: '2026-04-02T11:00:00.000Z',
    values: {
      card_network: 'American Express',
      card_kind: 'Credit',
      cardholder_name: 'PERSON A',
      number: '378282246310005',
      exp_month: '11',
      exp_year: '2029',
      cvv: '7890',
      issuing_bank: 'Bank Gamma',
    },
  },
  {
    id: 'secret-recovery-note',
    name: 'Recovery steps',
    description: 'Where the spare keys live',
    type: TYPE_NOTE,
    currentVersion: 1,
    createdAt: '2026-05-05T07:00:00.000Z',
    updatedAt: '2026-05-05T07:00:00.000Z',
    values: { content: 'Spare keys are in the drawer labelled Org Alpha.' },
  },
];

/**
 * A test-only system type with the field model of #207: a `last4` mask, a
 * `country` field, a `multiline` field and a `keyvalue` field.
 */
export const TYPE_DOCUMENT_FIXTURE = systemType('type-document-fixture', 'Document Fixture', 'Field model fixture', 'Badge', [
  field('holder', 'Holder', true, false),
  field('number', 'Document number', true, true, { mask: 'last4' }),
  field('country', 'Issuing country', false, false, { format: 'country' }),
  field('remarks', 'Remarks', false, false, { format: 'multiline' }),
  field('details', 'Details', false, false, { type: 'keyvalue' }),
]);

/**
 * Secrets the detail route answers but the list does not hold, so a new
 * screenshot does not move the list baselines.
 */
export const DETAIL_ONLY_SECRETS: FixtureSecret[] = [
  {
    id: 'secret-document-fixture',
    name: 'Person A document',
    description: null,
    type: TYPE_DOCUMENT_FIXTURE,
    currentVersion: 1,
    createdAt: '2026-04-10T09:00:00.000Z',
    updatedAt: '2026-04-10T09:00:00.000Z',
    values: {
      holder: 'Person A',
      number: 'X1234567',
      country: 'UTO',
      remarks: 'Specimen document.\nInvented values only.',
      details: [
        { key: 'class', label: 'Class', value: 'B', sensitive: false },
        { key: 'restrictions', label: 'Restrictions', value: 'None', sensitive: false },
        { key: 'pin', label: 'PIN', value: '0000-placeholder', sensitive: true },
      ],
    },
  },
];

/** The card summaries `GET /secrets/cards/summary` answers (last four digits and expiry only). */
export const CARD_SUMMARIES = [
  {
    id: 'secret-card-mc',
    name: 'Mastercard ending 4444',
    last4: '4444',
    expMonth: 5,
    expYear: 2026,
    network: 'Mastercard',
    kind: 'Debit',
    issuingBank: 'Bank Beta',
    cardholderName: 'PERSON A',
    hasPhotos: false,
    updatedAt: '2026-05-20T11:00:00.000Z',
  },
  {
    id: 'secret-card-visa',
    name: 'Visa ending 1111',
    last4: '1111',
    expMonth: 7,
    expYear: 2026,
    network: 'Visa',
    kind: 'Credit',
    issuingBank: 'Bank Alpha',
    cardholderName: 'PERSON A',
    hasPhotos: false,
    updatedAt: '2026-06-01T11:00:00.000Z',
  },
  {
    id: 'secret-card-amex',
    name: 'Amex ending 8431',
    last4: '8431',
    expMonth: 11,
    expYear: 2029,
    network: 'American Express',
    kind: 'Credit',
    issuingBank: 'Bank Gamma',
    cardholderName: 'PERSON A',
    hasPhotos: false,
    updatedAt: '2026-04-02T11:00:00.000Z',
  },
];

/** What the mocked card extraction answers: the fields a model could read off a test card. */
export const CARD_EXTRACTION = {
  fields: {
    cardholder_name: 'PERSON A',
    number: '4111111111111111',
    exp_month: '09',
    exp_year: '2029',
    cvv: null,
    card_network: 'Visa',
    card_kind: 'Credit',
    issuing_bank: 'Bank Delta',
    security_code_2: null,
    notes: null,
  },
  confidence: {
    cardholder_name: 0.98,
    number: 0.99,
    exp_month: 0.97,
    exp_year: 0.97,
    cvv: 0,
    card_network: 0.95,
    card_kind: 0.9,
    issuing_bank: 0.92,
    security_code_2: 0,
    notes: 0,
  },
  warnings: [],
  model: 'mock-vision-model',
  partial: false,
  crops: {
    front: { x: 0.05, y: 0.1, width: 0.9, height: 0.8, quarterTurns: 0, confidence: 0.96 },
    back: null,
  },
};

export const BACKUP_RUN = {
  id: 'backup-run-1',
  status: 'succeeded',
  trigger: 'manual',
  triggeredBy: { id: 'user-person-a', email: 'person.a@example.test', displayName: 'Person A' },
  sizeBytes: 48213,
  userCount: 1,
  secretCount: 6,
  attachmentCount: 0,
  mediaFileCount: 0,
  contents: ['secrets', 'versions'],
  warningCount: 0,
  error: null,
  startedAt: '2026-06-14T02:00:00.000Z',
  finishedAt: '2026-06-14T02:00:09.000Z',
  deletedAt: null,
  downloadable: true,
};

export const MEDIA_FOLDERS = [
  {
    id: 'folder-trips',
    name: 'Trips',
    userId: 'user-person-a',
    fileCount: 4,
    createdAt: '2026-03-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
  },
];

/**
 * The ID Document system type (ADR-0004) for the "Scan an ID" flow (#211).
 * Served by `/secret-types` only, outside `SECRET_TYPES`, so no list baseline moves.
 */
export const TYPE_ID_DOCUMENT = systemType(
  'type-id-document',
  'ID Document',
  'Driver license, ID card and other ID documents',
  'AssignmentInd',
  [
    field('document_kind', 'Document Kind', true, false, {
      type: 'select',
      options: ['Driver License', 'National ID', 'Permanent Resident Card', 'Other'],
    }),
    field('holder_name', 'Holder Name', true, false),
    field('document_number', 'Document Number', false, true, { mask: 'last4' }),
    field('issuing_country', 'Issuing Country', false, false, { format: 'country' }),
    field('issuing_authority', 'Issuing Authority / State', false, false),
    field('date_of_birth', 'Date of Birth', false, true, { type: 'date' }),
    field('issue_date', 'Issue Date', false, false, { type: 'date' }),
    field('expiry_date', 'Expiry Date', false, false, { type: 'date' }),
    field('attributes', 'Details', false, false, { type: 'keyvalue' }),
    field('notes', 'Notes', false, false, { format: 'multiline' }),
  ],
  true,
);

/** What the mocked document extraction answers: an invented specimen licence. */
export const DOCUMENT_EXTRACTION = {
  documentType: 'id_document',
  fields: {
    holder_name: 'PERSON A EXAMPLE',
    document_number: 'D0000000',
    issuing_country: 'UTO',
    issuing_authority: 'Specimen State',
    date_of_birth: '1980-01-01',
    issue_date: '2024-02-02',
    expiry_date: '2032-02-02',
    notes: null,
  },
  confidence: {
    holder_name: 0.97,
    document_number: 0.55,
    issuing_country: 0.95,
    issuing_authority: 0.9,
    date_of_birth: 0.93,
    issue_date: 0.9,
    expiry_date: 0.94,
  },
  documentKind: { value: 'Driver License', confidence: 0.92 },
  attributes: [
    { key: 'license_class', label: 'Class', value: 'C', sensitive: false, confidence: 0.95 },
    { key: 'restrictions', label: 'Restrictions', value: 'NONE', sensitive: false, confidence: 0.45 },
  ],
  checks: [],
  warnings: ['The document number was hard to read.'],
  crops: { front: { x: 0.05, y: 0.1, width: 0.9, height: 0.8, quarterTurns: 0, confidence: 0.95 } },
  model: 'mock-vision-model',
  partial: false,
};

/** A 1x1 transparent PNG, enough for an `<img>` that must decode. */
export const PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/**
 * Merchant grants and pending grant requests of the Visa card (ADR-0003, #195): one active shop
 * and one request, so the card's Agent access panel has both sections. No card value: grants and
 * requests never carry one.
 */
export const CARD_GRANTS: Record<string, unknown[]> = {
  'secret-card-visa': [
    {
      id: 'grant-shop-a',
      secretId: 'secret-card-visa',
      merchantOrigin: 'https://shop.example.test',
      merchantSite: 'example.test',
      frameOrigins: ['https://pay.example.test'],
      maxAmount: 150,
      currency: 'USD',
      periodLimit: { period: 'month', maxReleases: 4, maxAmount: null },
      expiresAt: null,
      includeSecurityCode: false,
      status: 'active',
      createdAt: '2026-03-01T09:00:00.000Z',
      revokedAt: null,
      usage: { periodReleases: 1, periodAmount: 42.5, totalReleases: 3, lastReleasedAt: '2026-03-10T09:00:00.000Z' },
    },
  ],
};

export const CARD_GRANT_REQUESTS: Record<string, unknown[]> = {
  'secret-card-visa': [
    {
      id: 'request-books-b',
      secretId: 'secret-card-visa',
      origin: 'https://books.example.test',
      merchantSite: 'example.test',
      amount: 38,
      currency: 'USD',
      reason: 'Order of two books for Person A',
      status: 'pending',
      clientName: 'Assistant X',
      createdAt: '2026-03-12T09:00:00.000Z',
      decidedAt: null,
      grantId: null,
    },
  ],
};
