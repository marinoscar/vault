/**
 * The identity-document catalog (ADR-0004): the kinds the `ID Document` system
 * type offers in its `document_kind` field, the standard `attributes` keys of
 * each kind, the deterministic checks that apply to it and the expiry reminder
 * lead days. Plain data: no I/O.
 */

/**
 * The `document_kind` options of the `ID Document` system type. Append-only:
 * a stored secret keeps its kind, so an option is never renamed or removed.
 *
 * @stability experimental
 */
export const ID_DOCUMENT_KINDS = [
  'Driver License',
  'National ID',
  'Permanent Resident Card',
  'Trusted Traveler Card',
  'Social Security Card',
  'Health Insurance Card',
  'Visa',
  'Work Permit',
  'Residence Permit',
  'Vehicle Registration',
  'Military ID',
  'Student ID',
  'Other',
] as const;

/** @stability experimental */
export type IdDocumentKind = (typeof ID_DOCUMENT_KINDS)[number];

/**
 * The ids of the deterministic document checks (`CheckId` of vault-api's
 * `ai/scan/checks`; a vault-api test pins the equality). A check only warns: it
 * never blocks a save.
 *
 * @stability experimental
 */
export const DOCUMENT_CHECK_IDS = ['mrz', 'ssn', 'vin', 'aamva'] as const;

/** @stability experimental */
export type DocumentCheckId = (typeof DOCUMENT_CHECK_IDS)[number];

/**
 * A standard `attributes` entry of a document kind: the snake_case key, the
 * label shown to the owner and whether the value is sensitive.
 *
 * @stability experimental
 */
export interface StandardAttributeKey {
  key: string;
  label: string;
  sensitive: boolean;
}

/**
 * What the catalog knows about one document kind.
 *
 * - `standardKeys`: the `attributes` entries the editor suggests and the scan
 *   asks the model for.
 * - `checks`: `ssn` applies to `document_number`, `vin` to `attributes.vin`,
 *   `mrz` to `attributes.mrz` (the MRZ lines), `aamva` to the values the
 *   browser decoded from the PDF417 barcode on the back (a Driver License).
 * - `expiryLeadDays`: days before `expiry_date` a reminder is due, descending;
 *   `[]` means no reminders.
 *
 * @stability experimental
 */
export interface IdDocumentKindSpec {
  kind: IdDocumentKind;
  standardKeys: readonly StandardAttributeKey[];
  checks: readonly DocumentCheckId[];
  expiryLeadDays: readonly number[];
}

const key = (k: string, label: string, sensitive = false): StandardAttributeKey => ({ key: k, label, sensitive });

const MRZ = key('mrz', 'Machine Readable Zone', true);
const SEX = key('sex', 'Sex');
const ADDRESS = key('address', 'Address');
const PERMIT_KEYS = [key('category', 'Category'), key('card_number', 'Card Number'), MRZ] as const;
const SERVICE_ID_KEYS = [key('rank_or_program', 'Rank or Program'), key('institution', 'Institution')] as const;
const STANDARD_LEAD_DAYS = [90, 30, 7, 0] as const;
const LONG_LEAD_DAYS = [180, 90, 30, 0] as const;
const SHORT_LEAD_DAYS = [30, 0] as const;

/**
 * The catalog: one {@link IdDocumentKindSpec} per {@link IdDocumentKind}.
 *
 * @stability experimental
 */
export const ID_DOCUMENT_KIND_CATALOG: Readonly<Record<IdDocumentKind, IdDocumentKindSpec>> = {
  'Driver License': {
    kind: 'Driver License',
    standardKeys: [
      key('license_class', 'Class'),
      key('restrictions', 'Restrictions'),
      key('endorsements', 'Endorsements'),
      ADDRESS,
      SEX,
      key('height', 'Height'),
      key('eye_color', 'Eye Color'),
      key('organ_donor', 'Organ Donor'),
    ],
    // The PDF417 barcode on the back, decoded in the browser (AAMVA, #214).
    checks: ['aamva'],
    expiryLeadDays: STANDARD_LEAD_DAYS,
  },
  'National ID': {
    kind: 'National ID',
    standardKeys: [ADDRESS, SEX, key('nationality', 'Nationality'), MRZ],
    checks: ['mrz'],
    expiryLeadDays: STANDARD_LEAD_DAYS,
  },
  'Permanent Resident Card': {
    kind: 'Permanent Resident Card',
    standardKeys: [
      key('uscis_number', 'USCIS Number', true),
      key('category', 'Category'),
      key('resident_since', 'Resident Since'),
      key('country_of_birth', 'Country of Birth'),
      SEX,
      MRZ,
    ],
    checks: ['mrz'],
    expiryLeadDays: LONG_LEAD_DAYS,
  },
  'Trusted Traveler Card': {
    kind: 'Trusted Traveler Card',
    standardKeys: [
      key('ktn', 'Known Traveler Number', true),
      // Global Entry, NEXUS, SENTRI or other.
      key('program', 'Program'),
      MRZ,
    ],
    checks: ['mrz'],
    expiryLeadDays: LONG_LEAD_DAYS,
  },
  'Social Security Card': {
    kind: 'Social Security Card',
    // The number is `document_number`.
    standardKeys: [],
    checks: ['ssn'],
    expiryLeadDays: [],
  },
  'Health Insurance Card': {
    kind: 'Health Insurance Card',
    standardKeys: [
      key('member_id', 'Member ID', true),
      key('group_number', 'Group Number'),
      key('payer', 'Payer'),
      key('plan', 'Plan'),
      key('rx_bin', 'Rx BIN'),
      key('rx_pcn', 'Rx PCN'),
      key('rx_group', 'Rx Group'),
      key('phone_member_services', 'Member Services Phone'),
      key('phone_provider', 'Provider Phone'),
    ],
    checks: [],
    expiryLeadDays: SHORT_LEAD_DAYS,
  },
  Visa: {
    kind: 'Visa',
    standardKeys: [
      key('visa_type', 'Visa Type'),
      key('entries', 'Entries'),
      key('annotation', 'Annotation'),
      key('control_number', 'Control Number'),
      MRZ,
    ],
    checks: ['mrz'],
    expiryLeadDays: STANDARD_LEAD_DAYS,
  },
  'Work Permit': {
    kind: 'Work Permit',
    standardKeys: PERMIT_KEYS,
    checks: ['mrz'],
    expiryLeadDays: STANDARD_LEAD_DAYS,
  },
  'Residence Permit': {
    kind: 'Residence Permit',
    standardKeys: PERMIT_KEYS,
    checks: ['mrz'],
    expiryLeadDays: STANDARD_LEAD_DAYS,
  },
  'Vehicle Registration': {
    kind: 'Vehicle Registration',
    standardKeys: [
      key('vin', 'VIN'),
      key('plate', 'Plate'),
      key('make', 'Make'),
      key('model', 'Model'),
      key('year', 'Year'),
      key('registered_owner', 'Registered Owner'),
    ],
    checks: ['vin'],
    expiryLeadDays: [30, 7, 0],
  },
  'Military ID': {
    kind: 'Military ID',
    standardKeys: SERVICE_ID_KEYS,
    checks: [],
    expiryLeadDays: SHORT_LEAD_DAYS,
  },
  'Student ID': {
    kind: 'Student ID',
    standardKeys: SERVICE_ID_KEYS,
    checks: [],
    expiryLeadDays: SHORT_LEAD_DAYS,
  },
  Other: {
    kind: 'Other',
    standardKeys: [],
    checks: [],
    expiryLeadDays: SHORT_LEAD_DAYS,
  },
};

/**
 * Days before a passport's `expiry_date` a reminder is due, descending. Many
 * countries refuse entry on a passport with less than six months left, hence
 * the long first lead.
 *
 * @stability experimental
 */
export const PASSPORT_EXPIRY_LEAD_DAYS = [270, 180, 90, 30, 0] as const;

/** Whether `value` is one of {@link ID_DOCUMENT_KINDS}. @stability experimental */
export function isIdDocumentKind(value: unknown): value is IdDocumentKind {
  return typeof value === 'string' && (ID_DOCUMENT_KINDS as readonly string[]).includes(value);
}

/**
 * The standard `attributes` keys of `kind`, or `[]` when `kind` is not a
 * catalog kind (unset, or a value from an older catalog).
 *
 * @stability experimental
 */
export function standardAttributeKeysFor(kind: unknown): readonly StandardAttributeKey[] {
  return isIdDocumentKind(kind) ? ID_DOCUMENT_KIND_CATALOG[kind].standardKeys : [];
}
