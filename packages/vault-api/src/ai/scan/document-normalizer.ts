// =============================================================================
// Identity-document scan normalizer (issue #210, IDOC-7)
// =============================================================================
// Pure functions: the model's (already validated and trimmed) answer in, the
// caller-facing `ExtractDocumentResponse` out. The deterministic checks of
// IDOC-2 (#205) run here: the MRZ check digits, the SSN structure, the VIN
// check digit, and (#214) the AAMVA barcode values the browser decoded from a
// driver license. A check only warns and adjusts confidence: the human decides.
//
// WARNINGS NEVER CARRY A VALUE. A warning this file writes names a field at
// most; a model warning that repeats an extracted value is dropped.
// =============================================================================

import {
  KEYVALUE_MAX_ENTRIES,
  ID_DOCUMENT_KINDS,
  isIdDocumentKind,
  standardAttributeKeysFor,
  type IdDocumentKind,
} from '@marinoscar/vault-contract/secret-types';
import type {
  DocumentBarcode,
  DocumentCheckResult,
  ExtractDocumentResponse,
  ScannedAttribute,
  ScannableDocumentType,
} from '@marinoscar/vault-contract/secrets';

import {
  checkSsn,
  checkVin,
  jurisdictionAgrees,
  normalizeDate,
  parseMrz,
  toAlpha3,
  type MrzParseResult,
} from './checks';
import type { ScanCropBox } from './crop-box';

/** Longest value kept for an ordinary field. @stability experimental */
export const DOCUMENT_FIELD_MAX_LENGTH = 200;
/** Longest machine-readable zone kept (the joined lines). @stability experimental */
export const DOCUMENT_MRZ_MAX_LENGTH = 2000;
/** Most attributes the model may return for an ID document. @stability experimental */
export const DOCUMENT_MAX_ATTRIBUTES = 40;

/**
 * The typed fields a passport scan returns (every Passport field but `notes`).
 * `mrz` is built from the model's `mrz_lines`, never read as a field.
 *
 * @stability experimental
 */
export const PASSPORT_SCAN_FIELDS = [
  'surname',
  'given_names',
  'passport_number',
  'passport_type',
  'issuing_country',
  'nationality',
  'date_of_birth',
  'place_of_birth',
  'sex',
  'issue_date',
  'expiry_date',
  'issuing_authority',
  'personal_number',
  'mrz',
] as const;

/**
 * The typed fields an ID document scan returns (the ID Document fields but
 * `document_kind`, `attributes` and `notes`; the kind is `documentKind`).
 *
 * @stability experimental
 */
export const ID_DOCUMENT_SCAN_FIELDS = [
  'holder_name',
  'document_number',
  'issuing_country',
  'issuing_authority',
  'date_of_birth',
  'issue_date',
  'expiry_date',
] as const;

const DATE_FIELDS = new Set(['date_of_birth', 'issue_date', 'expiry_date']);
const COUNTRY_FIELDS = new Set(['issuing_country', 'nationality']);

/** The warning a misread value replaced by the machine-readable zone carries. @stability experimental */
export const MRZ_WINS_WARNING = 'Read from the machine-readable zone; the printed value looked different';

/** The warning a misread value replaced by the driver license barcode carries. @stability experimental */
export const BARCODE_WINS_WARNING = 'Read from the barcode; the printed value looked different';

/** Confidence of a value the barcode replaced. @stability experimental */
export const BARCODE_WINS_CONFIDENCE = 0.95;

/** One attribute as the model returned it (trimmed). @stability experimental */
export interface RawScannedAttribute {
  key: string | null;
  label: string;
  value: string;
  confidence: number;
}

/**
 * A document scan answer after the repair step: strings trimmed and capped,
 * confidences clamped, boxes repaired. Field names are the target type's.
 *
 * @stability experimental
 */
export interface RawDocumentScan {
  fields: Record<string, string | null>;
  confidence: Record<string, number>;
  mrzLines: string[] | null;
  mrzConfidence: number;
  warnings: string[];
  /** Keyed by image slot (`data_page`, `front`, `back`). */
  boxes: Record<string, ScanCropBox | null>;
  /** ID document only. */
  documentKind?: string | null;
  documentKindConfidence?: number;
  attributes?: RawScannedAttribute[];
  barcodePresent?: boolean;
  model: string;
}

/** What the normalizer needs besides the answer. @stability experimental */
export interface DocumentNormalizeContext {
  /** The image slots actually sent, in slot order; a box for any other slot is dropped. */
  providedSlots: readonly string[];
  /** The image slots of the profile, in slot order. */
  slots: readonly string[];
  /** Reference day for the MRZ date century rule. */
  today: Date;
  /**
   * The AAMVA barcode values the browser decoded from the back (issue #214);
   * cross-checked for a Driver License only, ignored otherwise.
   */
  barcode?: DocumentBarcode | null;
}

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------

const clamp01 = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Trims a string and caps its length; empty becomes `null`. @stability experimental */
export function cleanText(value: unknown, max = DOCUMENT_FIELD_MAX_LENGTH): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, max);
}

/** Upper-case letters and digits only (comparison key for numbers). */
const alnum = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Letters only, without diacritics, as sorted tokens (comparison key for names). */
function nameTokens(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .sort();
}

/** Whether a printed name and the MRZ name agree (the MRZ may drop diacritics or be truncated). */
function namesAgree(printed: string, mrz: string): boolean {
  const a = nameTokens(printed).join(' ');
  const b = nameTokens(mrz).join(' ');
  if (a === b) return true;
  const flatA = nameTokens(printed).join('');
  const flatB = nameTokens(mrz).join('');
  return flatA === flatB || (flatB.length >= 30 && flatA.startsWith(flatB));
}

/** `M`, `F` or `X` from what the page prints, or `null`. */
function normalizeSex(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim().toUpperCase();
  if (v === 'M' || v === 'MALE' || v.startsWith('M/')) return 'M';
  if (v === 'F' || v === 'FEMALE' || v.startsWith('F/')) return 'F';
  if (v === 'X' || v === '<') return 'X';
  return null;
}

/**
 * snake_case key from a label (`Rx BIN` -> `rx_bin`), at most 50 characters and
 * starting with a letter; `field` when nothing is left.
 *
 * @stability experimental
 */
export function attributeKeyFromLabel(label: string): string {
  let key = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!/^[a-z]/.test(key)) key = key === '' ? 'field' : `field_${key}`;
  return key.slice(0, 50).replace(/_+$/, '');
}

const humanize = (key: string): string => {
  const words = key.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// -----------------------------------------------------------------------------
// Shared steps
// -----------------------------------------------------------------------------

class Draft {
  readonly fields: Record<string, string | null> = {};
  readonly confidence: Record<string, number> = {};
  readonly warnings: string[] = [];
  readonly checks: DocumentCheckResult[] = [];

  constructor(names: readonly string[], raw: RawDocumentScan) {
    for (const name of names) {
      const value = cleanText(raw.fields[name]);
      this.fields[name] = value;
      this.confidence[name] = value === null ? 0 : clamp01(raw.confidence[name]);
    }
  }

  set(name: string, value: string | null, confidence?: number): void {
    this.fields[name] = value;
    if (value === null) this.confidence[name] = 0;
    else if (confidence !== undefined) this.confidence[name] = clamp01(confidence);
  }

  cap(name: string, max: number): void {
    if (name in this.confidence) this.confidence[name] = Math.min(this.confidence[name], max);
  }

  warn(message: string): void {
    this.warnings.push(message);
  }

  /** Dates to `YYYY-MM-DD`; an unreadable date becomes `null` with a warning naming the field. */
  normalizeDates(): void {
    for (const name of Object.keys(this.fields)) {
      const value = this.fields[name];
      if (!DATE_FIELDS.has(name) || value === null) continue;
      const iso = normalizeDate(value);
      if (iso === null) {
        this.set(name, null);
        this.warn(`Could not read ${name} as a date; enter it by hand`);
      } else this.fields[name] = iso;
    }
  }

  /** Countries to alpha-3; an unknown country keeps the printed text, with a warning. */
  normalizeCountries(): void {
    for (const name of Object.keys(this.fields)) {
      const value = this.fields[name];
      if (!COUNTRY_FIELDS.has(name) || value === null) continue;
      const code = toAlpha3(value);
      if (code === null) {
        this.warn(`${name} is not a known country code; check it`);
        this.cap(name, 0.5);
      } else this.fields[name] = code;
    }
  }
}

/** Which typed field each MRZ check guards, per document type. */
const MRZ_CHECK_FIELD: Record<ScannableDocumentType, Record<string, string>> = {
  passport: {
    documentNumber: 'passport_number',
    birthDate: 'date_of_birth',
    expiryDate: 'expiry_date',
    personalNumber: 'personal_number',
    composite: 'mrz',
  },
  id_document: {
    documentNumber: 'document_number',
    birthDate: 'date_of_birth',
    expiryDate: 'expiry_date',
    personalNumber: 'personal_number',
    composite: 'mrz',
  },
};

/**
 * Runs the MRZ: parses the lines, records the `mrz` check, warns and caps the
 * confidence of each field whose check digit fails, and returns the parse when
 * every check digit is valid (the caller reconciles the printed values).
 */
function runMrz(
  draft: Draft,
  lines: string[] | null,
  documentType: ScannableDocumentType,
  today: Date,
): { joined: string | null; valid: MrzParseResult | null } {
  const cleaned = (lines ?? []).map((l) => l.trim()).filter((l) => l !== '');
  if (cleaned.length === 0) return { joined: null, valid: null };
  const joined = cleaned.join('\n').slice(0, DOCUMENT_MRZ_MAX_LENGTH);
  const parsed = parseMrz(joined, { today });
  if (!parsed) {
    draft.checks.push({ id: 'mrz', ok: false, failed: ['mrz'] });
    draft.warn('The machine-readable zone could not be read; check mrz');
    return { joined, valid: null };
  }
  const failed = parsed.checks.filter((c) => !c.ok).map((c) => MRZ_CHECK_FIELD[documentType][c.field]);
  draft.checks.push({ id: 'mrz', ok: parsed.valid, failed });
  for (const field of failed) {
    draft.warn(`A machine-readable zone check digit failed for ${field}; check it`);
    draft.cap(field, 0.5);
  }
  return { joined, valid: parsed.valid ? parsed : null };
}

/** Replaces a printed value that disagrees with the (valid) MRZ; fills a missing one. */
function reconcile(
  draft: Draft,
  name: string,
  mrzValue: string | null,
  agree: (printed: string, mrz: string) => boolean = (a, b) => a === b,
): void {
  if (mrzValue === null || mrzValue === '') return;
  const printed = draft.fields[name];
  if (printed === null || printed === undefined) {
    draft.set(name, mrzValue, 0.9);
    return;
  }
  if (agree(printed, mrzValue)) return;
  draft.set(name, mrzValue, Math.max(0.9, draft.confidence[name] ?? 0));
  draft.warn(`${MRZ_WINS_WARNING} (${name})`);
}

function crops(raw: RawDocumentScan, ctx: DocumentNormalizeContext): ExtractDocumentResponse['crops'] {
  const out: ExtractDocumentResponse['crops'] = {};
  for (const slot of ctx.slots as Array<keyof ExtractDocumentResponse['crops']>) {
    // A box for an image that was never sent is a hallucination.
    out[slot] = ctx.providedSlots.includes(slot) ? (raw.boxes[slot] ?? null) : null;
  }
  return out;
}

/** Model warnings, minus any that repeat a value; then deduplicated after ours. */
function finishWarnings(own: string[], model: string[], values: Array<string | null | undefined>): string[] {
  const needles = values
    .filter((v): v is string => typeof v === 'string')
    .flatMap((v) => v.split('\n'))
    .map(alnum)
    .filter((v) => v.length >= 4);
  const safe = model
    .map((w) => cleanText(w))
    .filter((w): w is string => w !== null)
    .filter((w) => !needles.some((n) => alnum(w).includes(n)));
  return [...new Set([...own, ...safe])];
}

const allNull = (fields: Record<string, string | null>): boolean => Object.values(fields).every((v) => v === null);

// -----------------------------------------------------------------------------
// Passport
// -----------------------------------------------------------------------------

/**
 * The passport scan result: dates and countries normalized, the MRZ joined
 * into `mrz` and, when its check digits are valid, preferred over a misread
 * visual zone.
 *
 * @stability experimental
 */
export function normalizePassportScan(raw: RawDocumentScan, ctx: DocumentNormalizeContext): ExtractDocumentResponse {
  const draft = new Draft(
    PASSPORT_SCAN_FIELDS.filter((f) => f !== 'mrz'),
    raw,
  );
  draft.set('sex', normalizeSex(draft.fields.sex));
  draft.normalizeDates();
  draft.normalizeCountries();

  const mrz = runMrz(draft, raw.mrzLines, 'passport', ctx.today);
  draft.set('mrz', mrz.joined, raw.mrzConfidence);
  const p = mrz.valid;
  if (p) {
    reconcile(draft, 'passport_number', p.documentNumber, (a, b) => alnum(a) === alnum(b));
    reconcile(draft, 'date_of_birth', p.birthDate);
    reconcile(draft, 'expiry_date', p.expiryDate);
    reconcile(draft, 'sex', p.sex);
    reconcile(draft, 'nationality', toAlpha3(p.nationality) ?? p.nationality);
    reconcile(draft, 'issuing_country', toAlpha3(p.issuingCountry) ?? p.issuingCountry);
    reconcile(draft, 'surname', p.surname || null, namesAgree);
    reconcile(draft, 'given_names', p.givenNames || null, namesAgree);
    if (p.personalNumber) reconcile(draft, 'personal_number', p.personalNumber, (a, b) => alnum(a) === alnum(b));
  }

  const { mrz: mrzField, ...typed } = draft.fields;
  return {
    documentType: 'passport',
    fields: draft.fields,
    confidence: draft.confidence,
    documentKind: null,
    attributes: [],
    checks: draft.checks,
    warnings: finishWarnings(draft.warnings, raw.warnings, [
      draft.fields.passport_number,
      draft.fields.personal_number,
      draft.fields.date_of_birth,
      mrzField,
    ]),
    crops: crops(raw, ctx),
    model: raw.model || null,
    partial: allNull(typed) && mrzField === null,
  };
}

// -----------------------------------------------------------------------------
// ID document
// -----------------------------------------------------------------------------

/**
 * The ID document scan result: the kind (`null` with a warning when unknown),
 * the core fields, the attributes keyed and marked sensitive from the catalog,
 * and the kind's checks (MRZ, SSN, VIN).
 *
 * @stability experimental
 */
export function normalizeIdDocumentScan(raw: RawDocumentScan, ctx: DocumentNormalizeContext): ExtractDocumentResponse {
  const draft = new Draft(ID_DOCUMENT_SCAN_FIELDS, raw);
  draft.normalizeDates();
  draft.normalizeCountries();

  // The kind.
  const rawKind = cleanText(raw.documentKind);
  let kind: IdDocumentKind | null = null;
  if (rawKind !== null && isIdDocumentKind(rawKind)) kind = rawKind;
  else if (rawKind !== null) {
    const match = ID_DOCUMENT_KINDS.find((k) => k.toLowerCase() === rawKind.toLowerCase());
    if (match) kind = match;
    else draft.warn('The document kind was not recognised; choose it by hand');
  } else draft.warn('The document kind could not be determined; choose it by hand');
  const documentKind = { value: kind, confidence: kind === null ? 0 : clamp01(raw.documentKindConfidence) };

  // The attributes.
  const standard = new Map(standardAttributeKeysFor(kind).map((s) => [s.key, s]));
  const typedNames = new Set<string>([...ID_DOCUMENT_SCAN_FIELDS, 'document_kind', 'attributes', 'notes']);
  const attributes: ScannedAttribute[] = [];
  const used = new Set<string>();
  const add = (entry: ScannedAttribute): void => {
    let key = entry.key;
    for (let n = 2; used.has(key); n += 1) key = `${entry.key.slice(0, 46)}_${n}`;
    used.add(key);
    attributes.push({ ...entry, key });
  };

  const mrz = runMrz(draft, raw.mrzLines, 'id_document', ctx.today);

  const fromModel: ScannedAttribute[] = [];
  for (const attr of (raw.attributes ?? []).slice(0, DOCUMENT_MAX_ATTRIBUTES)) {
    const label = cleanText(attr.label, 100);
    const rawKey = cleanText(attr.key, 50);
    const key = rawKey !== null ? attributeKeyFromLabel(rawKey) : label !== null ? attributeKeyFromLabel(label) : null;
    if (key === null) continue;
    const value = cleanText(attr.value, key === 'mrz' ? DOCUMENT_MRZ_MAX_LENGTH : DOCUMENT_FIELD_MAX_LENGTH);
    if (value === null) continue;
    // The MRZ is built from `mrz_lines`; a typed field never doubles as an attribute.
    if (key === 'mrz' || typedNames.has(key)) continue;
    const spec = standard.get(key);
    fromModel.push({
      key,
      label: label ?? spec?.label ?? humanize(key),
      value,
      sensitive: spec?.sensitive ?? false,
      confidence: clamp01(attr.confidence),
    });
  }

  // MRZ reconciliation against the visual zone.
  const p = mrz.valid;
  if (p) {
    reconcile(draft, 'document_number', p.documentNumber, (a, b) => alnum(a) === alnum(b));
    reconcile(draft, 'date_of_birth', p.birthDate);
    reconcile(draft, 'expiry_date', p.expiryDate);
    reconcile(draft, 'issuing_country', toAlpha3(p.issuingCountry) ?? p.issuingCountry);
    const mrzName = [p.givenNames, p.surname].filter(Boolean).join(' ');
    reconcile(draft, 'holder_name', mrzName || null, namesAgree);
    const mrzAttr: Record<string, string | null> = {
      sex: p.sex,
      nationality: toAlpha3(p.nationality) ?? (p.nationality || null),
    };
    for (const [key, value] of Object.entries(mrzAttr)) {
      if (!value) continue;
      const existing = fromModel.find((a) => a.key === key);
      if (!existing) {
        fromModel.push({
          key,
          label: standard.get(key)?.label ?? humanize(key),
          value,
          sensitive: standard.get(key)?.sensitive ?? false,
          confidence: 0.9,
        });
      } else if (alnum(comparableAttribute(key, existing.value)) !== alnum(value)) {
        existing.value = value;
        existing.confidence = Math.max(0.9, existing.confidence);
        draft.warn(`${MRZ_WINS_WARNING} (${key})`);
      }
    }
  }

  // AAMVA: the barcode on the back of a driver license.
  if (kind === 'Driver License' && ctx.barcode?.format === 'aamva') {
    crossCheckBarcode(draft, fromModel, standard, ctx.barcode);
  }

  // SSN: the number is `document_number`.
  if (kind === 'Social Security Card' && draft.fields.document_number !== null) {
    const ssn = checkSsn(draft.fields.document_number);
    if (ssn.normalized !== null) draft.fields.document_number = ssn.normalized;
    draft.checks.push({ id: 'ssn', ok: ssn.ok, failed: ssn.ok ? [] : ['document_number'] });
    if (!ssn.ok) {
      draft.warn('document_number does not have the structure of a Social Security number; check it');
      draft.cap('document_number', 0.5);
    }
  }

  // VIN: the `vin` attribute.
  if (kind === 'Vehicle Registration') {
    const vin = fromModel.find((a) => a.key === 'vin');
    if (vin) {
      const result = checkVin(vin.value);
      if (result.normalized !== null) vin.value = result.normalized;
      draft.checks.push({ id: 'vin', ok: result.ok, failed: result.ok ? [] : ['vin'] });
      if (!result.ok) {
        draft.warn('The vin check digit or format is not valid; check it');
        vin.confidence = Math.min(vin.confidence, 0.5);
      }
    }
  }

  // Never the document number as an attribute.
  const numberKey = alnum(draft.fields.document_number ?? '');
  for (const entry of fromModel) {
    if (numberKey !== '' && alnum(entry.value) === numberKey) continue;
    add(entry);
  }
  if (mrz.joined !== null) {
    add({
      key: 'mrz',
      label: standard.get('mrz')?.label ?? 'Machine Readable Zone',
      value: mrz.joined,
      // The MRZ repeats the document number and the date of birth: sensitive whatever the kind.
      sensitive: true,
      confidence: clamp01(raw.mrzConfidence),
    });
  }

  return {
    documentType: 'id_document',
    fields: draft.fields,
    confidence: draft.confidence,
    documentKind,
    attributes: attributes.slice(0, KEYVALUE_MAX_ENTRIES),
    checks: draft.checks,
    warnings: finishWarnings(draft.warnings, raw.warnings, [
      draft.fields.document_number,
      draft.fields.date_of_birth,
      mrz.joined,
      ...attributes.filter((a) => a.sensitive).map((a) => a.value),
    ]),
    crops: crops(raw, ctx),
    model: raw.model || null,
    partial: allNull(draft.fields),
    barcodePresent: raw.barcodePresent === true,
  };
}

/**
 * Compares the decoded barcode with what the model read: a missing value is
 * filled, a value that disagrees is replaced by the barcode's (confidence
 * {@link BARCODE_WINS_CONFIDENCE}, a warning naming the field), and the `aamva`
 * check lists the fields that disagreed. Never a value in a warning.
 */
function crossCheckBarcode(
  draft: Draft,
  attributes: ScannedAttribute[],
  standard: ReadonlyMap<string, { label: string; sensitive: boolean }>,
  barcode: DocumentBarcode,
): void {
  const b = barcode.fields;
  const value = (v: string | undefined): string | null => cleanText(v);
  const failed: string[] = [];

  const field = (name: string, decoded: string | null, agree: (printed: string, decoded: string) => boolean): void => {
    if (decoded === null) return;
    const printed = draft.fields[name];
    if (printed === null || printed === undefined) {
      draft.set(name, decoded, 0.9);
      return;
    }
    if (agree(printed, decoded)) return;
    draft.set(name, decoded, BARCODE_WINS_CONFIDENCE);
    draft.warn(`${BARCODE_WINS_WARNING} (${name})`);
    failed.push(name);
  };
  const isoDate = (v: string | undefined): string | null => {
    const text = value(v);
    return text === null ? null : normalizeDate(text);
  };
  const same = (a: string, c: string): boolean => a === c;

  field('document_number', value(b.documentNumber), (a, c) => alnum(a) === alnum(c));
  const name = [value(b.givenNames), value(b.familyName)].filter(Boolean).join(' ');
  field('holder_name', name === '' ? null : name.slice(0, DOCUMENT_FIELD_MAX_LENGTH), namesAgree);
  field('date_of_birth', isoDate(b.birthDate), same);
  field('expiry_date', isoDate(b.expiryDate), same);
  field('issue_date', isoDate(b.issueDate), same);
  field('issuing_authority', value(b.state)?.toUpperCase() ?? null, jurisdictionAgrees);
  // The country only fills a gap: the barcode names USA or CAN, which the front rarely misprints.
  const country = value(b.country);
  if (draft.fields.issuing_country === null && country !== null) {
    const code = toAlpha3(country);
    if (code !== null) draft.set('issuing_country', code, 0.9);
  }

  const attribute = (key: string, decoded: string | null, agree: (printed: string, decoded: string) => boolean): void => {
    if (decoded === null) return;
    const existing = attributes.find((a) => a.key === key);
    if (!existing) {
      attributes.push({
        key,
        label: standard.get(key)?.label ?? humanize(key),
        value: decoded,
        sensitive: standard.get(key)?.sensitive ?? false,
        confidence: 0.9,
      });
      return;
    }
    if (agree(existing.value, decoded)) return;
    existing.value = decoded;
    existing.confidence = BARCODE_WINS_CONFIDENCE;
    draft.warn(`${BARCODE_WINS_WARNING} (${key})`);
    failed.push(key);
  };
  const sameText = (a: string, c: string): boolean => alnum(a) === alnum(c);
  attribute('license_class', value(b.licenseClass), sameText);
  attribute('restrictions', value(b.restrictions), sameText);
  attribute('endorsements', value(b.endorsements), sameText);
  attribute('sex', normalizeSex(value(b.sex)), (a, c) => (normalizeSex(a) ?? a) === c);

  draft.checks.push({ id: 'aamva', ok: failed.length === 0, failed });
}

/** A printed `sex` or `nationality` attribute in the form the MRZ uses. */
function comparableAttribute(key: string, value: string): string {
  if (key === 'sex') return normalizeSex(value) ?? value;
  return toAlpha3(value) ?? value;
}
