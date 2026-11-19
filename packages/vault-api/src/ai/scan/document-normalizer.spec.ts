// Fixtures are invented: the ICAO 9303 specimen state UTO and its specimen holder
// (ERIKSSON, ANNA MARIA), invalid-by-construction SSNs and a made-up VIN.
import { extractDocumentResponseSchema } from '@marinoscar/vault-contract/secrets';

import { vinCheckDigit } from './checks';
import {
  attributeKeyFromLabel,
  MRZ_WINS_WARNING,
  normalizeIdDocumentScan,
  normalizePassportScan,
  type RawDocumentScan,
} from './document-normalizer';

const TODAY = new Date(Date.UTC(2010, 0, 1));
const TD3 = [
  'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
  'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
];
const TD1 = [
  'I<UTOD231458907<<<<<<<<<<<<<<<',
  '7408122F1204159UTO<<<<<<<<<<<6',
  'ERIKSSON<<ANNA<MARIA<<<<<<<<<<',
];
const set = (line: string, i: number, ch: string): string => line.slice(0, i) + ch + line.slice(i + 1);

const box = { x: 0.1, y: 0.1, width: 0.8, height: 0.6, quarterTurns: 0, confidence: 0.9 };

function passportRaw(over: Partial<RawDocumentScan> = {}): RawDocumentScan {
  return {
    fields: {
      surname: 'Eriksson',
      given_names: 'Anna Maria',
      passport_number: 'L898902C3',
      passport_type: 'P',
      issuing_country: 'UTO',
      nationality: 'UTO',
      date_of_birth: '12 AUG 1974',
      place_of_birth: 'Zenith',
      sex: 'F',
      issue_date: '1999-04-16',
      expiry_date: '2012-04-15',
      issuing_authority: 'Passport Office',
      personal_number: 'ZE184226B',
    },
    confidence: Object.fromEntries(
      ['surname', 'given_names', 'passport_number', 'passport_type', 'issuing_country', 'nationality', 'date_of_birth', 'place_of_birth', 'sex', 'issue_date', 'expiry_date', 'issuing_authority', 'personal_number'].map((f) => [f, 0.8]),
    ),
    mrzLines: [...TD3],
    mrzConfidence: 0.95,
    warnings: [],
    boxes: { data_page: box, back: box },
    model: 'model-a',
    ...over,
  };
}

function idRaw(over: Partial<RawDocumentScan> = {}): RawDocumentScan {
  return {
    fields: {
      holder_name: 'Person A',
      document_number: null,
      issuing_country: 'UTO',
      issuing_authority: 'Utopia Agency',
      date_of_birth: null,
      issue_date: null,
      expiry_date: null,
    },
    confidence: { holder_name: 0.9, document_number: 0.9, issuing_country: 0.9, issuing_authority: 0.9, date_of_birth: 0, issue_date: 0, expiry_date: 0 },
    documentKind: 'National ID',
    documentKindConfidence: 0.95,
    attributes: [],
    mrzLines: null,
    mrzConfidence: 0,
    warnings: [],
    boxes: { front: box, back: null },
    model: 'model-a',
    ...over,
  };
}

const passportCtx = { providedSlots: ['data_page'], slots: ['data_page', 'back'], today: TODAY };
const idCtx = { providedSlots: ['front'], slots: ['front', 'back'], today: TODAY };

describe('normalizePassportScan', () => {
  it('normalizes dates and countries, joins the MRZ and passes its checks', () => {
    const out = normalizePassportScan(passportRaw(), passportCtx);
    expect(extractDocumentResponseSchema.parse(out)).toEqual(out);
    expect(out.fields).toMatchObject({
      date_of_birth: '1974-08-12',
      expiry_date: '2012-04-15',
      issuing_country: 'UTO',
      sex: 'F',
      mrz: TD3.join('\n'),
    });
    expect(out.checks).toEqual([{ id: 'mrz', ok: true, failed: [] }]);
    expect(out.warnings).toEqual([]);
    expect(out.documentKind).toBeNull();
    expect(out.attributes).toEqual([]);
    expect(out.partial).toBe(false);
    // The back box of an image that was never sent is dropped.
    expect(out.crops).toEqual({ data_page: box, back: null });
  });

  it('lets a valid MRZ win over a misread visual value, with a warning naming the field only', () => {
    const raw = passportRaw();
    raw.fields.passport_number = 'L898902CB';
    raw.fields.date_of_birth = '1974-08-13';
    raw.confidence.passport_number = 0.4;
    const out = normalizePassportScan(raw, passportCtx);
    expect(out.fields.passport_number).toBe('L898902C3');
    expect(out.fields.date_of_birth).toBe('1974-08-12');
    expect(out.confidence.passport_number).toBeGreaterThanOrEqual(0.9);
    expect(out.warnings).toEqual([
      `${MRZ_WINS_WARNING} (passport_number)`,
      `${MRZ_WINS_WARNING} (date_of_birth)`,
    ]);
    expect(out.warnings.join(' ')).not.toContain('L898902');
  });

  it('fills a field the visual zone missed from a valid MRZ', () => {
    const raw = passportRaw();
    raw.fields.nationality = null;
    const out = normalizePassportScan(raw, passportCtx);
    expect(out.fields.nationality).toBe('UTO');
    expect(out.warnings).toEqual([]);
  });

  it('keeps names that only differ by case or diacritics', () => {
    const raw = passportRaw();
    raw.fields.given_names = 'Ánna María';
    const out = normalizePassportScan(raw, passportCtx);
    expect(out.fields.given_names).toBe('Ánna María');
  });

  it('caps the confidence of a field whose check digit fails, warns, and keeps the visual value', () => {
    const raw = passportRaw({ mrzLines: [TD3[0], set(TD3[1], 19, '3')] });
    raw.fields.date_of_birth = '1974-08-13';
    const out = normalizePassportScan(raw, passportCtx);
    expect(out.checks).toEqual([{ id: 'mrz', ok: false, failed: ['date_of_birth', 'mrz'] }]);
    expect(out.fields.date_of_birth).toBe('1974-08-13');
    expect(out.confidence.date_of_birth).toBeLessThanOrEqual(0.5);
    expect(out.warnings).toContain('A machine-readable zone check digit failed for date_of_birth; check it');
  });

  it('warns when the MRZ cannot be parsed', () => {
    const out = normalizePassportScan(passportRaw({ mrzLines: ['NOT AN MRZ'] }), passportCtx);
    expect(out.checks).toEqual([{ id: 'mrz', ok: false, failed: ['mrz'] }]);
    expect(out.warnings).toContain('The machine-readable zone could not be read; check mrz');
  });

  it('keeps an unknown country as printed, with a warning', () => {
    const raw = passportRaw({ mrzLines: null });
    raw.fields.issuing_country = 'Atlantis';
    const out = normalizePassportScan(raw, passportCtx);
    expect(out.fields.issuing_country).toBe('Atlantis');
    expect(out.confidence.issuing_country).toBe(0.5);
    expect(out.warnings).toEqual(['issuing_country is not a known country code; check it']);
  });

  it('drops a model warning that repeats a value', () => {
    const out = normalizePassportScan(passportRaw({ warnings: ['Number L898902C3 is blurry', 'Glare on the photo'] }), passportCtx);
    expect(out.warnings).toEqual(['Glare on the photo']);
  });

  it('is partial when nothing was read', () => {
    const fields = Object.fromEntries(Object.keys(passportRaw().fields).map((k) => [k, null]));
    const out = normalizePassportScan(passportRaw({ fields, mrzLines: null }), passportCtx);
    expect(out.partial).toBe(true);
    expect(Object.values(out.confidence).every((c) => c === 0)).toBe(true);
  });
});

describe('normalizeIdDocumentScan', () => {
  it('reads a TD1 card: the MRZ attribute (sensitive), reconciled number and dates', () => {
    const out = normalizeIdDocumentScan(idRaw({ mrzLines: [...TD1], mrzConfidence: 0.9 }), idCtx);
    expect(extractDocumentResponseSchema.parse(out)).toEqual(out);
    expect(out.documentKind).toEqual({ value: 'National ID', confidence: 0.95 });
    expect(out.fields).toMatchObject({ document_number: 'D23145890', date_of_birth: '1974-08-12', expiry_date: '2012-04-15' });
    expect(out.checks).toEqual([{ id: 'mrz', ok: true, failed: [] }]);
    // The printed name "Person A" differs from the MRZ name: the MRZ wins.
    expect(out.fields.holder_name).toBe('ANNA MARIA ERIKSSON');
    expect(out.warnings).toEqual([`${MRZ_WINS_WARNING} (holder_name)`]);
    const mrz = out.attributes.find((a) => a.key === 'mrz');
    expect(mrz).toMatchObject({ value: TD1.join('\n'), sensitive: true, label: 'Machine Readable Zone' });
    expect(out.attributes.find((a) => a.key === 'sex')).toMatchObject({ value: 'F', sensitive: false });
    expect(out.attributes.find((a) => a.key === 'nationality')).toMatchObject({ value: 'UTO' });
  });

  it('derives keys from labels, deduplicates, marks catalog-sensitive keys and drops empty values', () => {
    const out = normalizeIdDocumentScan(
      idRaw({
        documentKind: 'Health Insurance Card',
        attributes: [
          { key: 'member_id', label: 'Member ID', value: 'XQ0001', confidence: 0.9 },
          { key: null, label: 'Rx BIN', value: '000000', confidence: 0.8 },
          { key: null, label: 'Copay (ER)', value: '$100', confidence: 0.7 },
          { key: null, label: 'Copay ER', value: '$50', confidence: 0.7 },
          { key: null, label: 'Empty', value: '   ', confidence: 0.7 },
        ],
      }),
      idCtx,
    );
    expect(out.attributes).toEqual([
      { key: 'member_id', label: 'Member ID', value: 'XQ0001', sensitive: true, confidence: 0.9 },
      { key: 'rx_bin', label: 'Rx BIN', value: '000000', sensitive: false, confidence: 0.8 },
      { key: 'copay_er', label: 'Copay (ER)', value: '$100', sensitive: false, confidence: 0.7 },
      { key: 'copay_er_2', label: 'Copay ER', value: '$50', sensitive: false, confidence: 0.7 },
    ]);
  });

  it('never returns the document number, a typed field or a model MRZ as an attribute', () => {
    const raw = idRaw({
      documentKind: 'Driver License',
      attributes: [
        { key: null, label: 'DL No', value: 'D 1234-5678', confidence: 0.9 },
        { key: 'date_of_birth', label: 'DOB', value: '01/31/1990', confidence: 0.9 },
        { key: 'mrz', label: 'MRZ', value: 'XX', confidence: 0.9 },
        { key: 'license_class', label: 'Class', value: 'C', confidence: 0.9 },
      ],
    });
    raw.fields.document_number = 'D1234-5678';
    const out = normalizeIdDocumentScan(raw, idCtx);
    expect(out.attributes.map((a) => a.key)).toEqual(['license_class']);
  });

  it('normalizes a Social Security number, and warns on a structural failure', () => {
    const ok = idRaw({ documentKind: 'Social Security Card' });
    ok.fields.document_number = '123456789';
    const good = normalizeIdDocumentScan(ok, idCtx);
    expect(good.fields.document_number).toBe('123-45-6789');
    expect(good.checks).toEqual([{ id: 'ssn', ok: true, failed: [] }]);
    expect(good.warnings).toEqual([]);

    const bad = idRaw({ documentKind: 'Social Security Card' });
    bad.fields.document_number = '900-12-3456';
    const out = normalizeIdDocumentScan(bad, idCtx);
    expect(out.checks).toEqual([{ id: 'ssn', ok: false, failed: ['document_number'] }]);
    expect(out.confidence.document_number).toBe(0.5);
    expect(out.warnings).toEqual(['document_number does not have the structure of a Social Security number; check it']);
    expect(out.warnings.join(' ')).not.toContain('900');
  });

  it('checks the VIN of a vehicle registration', () => {
    const body = '5ZZTSTVN0AX123456';
    const vin = set(body, 8, vinCheckDigit(body));
    const wrong = set(vin, 8, vin[8] === '1' ? '2' : '1');
    const run = (value: string) =>
      normalizeIdDocumentScan(
        idRaw({ documentKind: 'Vehicle Registration', attributes: [{ key: 'vin', label: 'VIN', value, confidence: 0.9 }] }),
        idCtx,
      );
    expect(run(vin.toLowerCase()).checks).toEqual([{ id: 'vin', ok: true, failed: [] }]);
    expect(run(vin.toLowerCase()).attributes[0].value).toBe(vin);
    const out = run(wrong);
    expect(out.checks).toEqual([{ id: 'vin', ok: false, failed: ['vin'] }]);
    expect(out.attributes[0].confidence).toBe(0.5);
    expect(out.warnings).toEqual(['The vin check digit or format is not valid; check it']);
  });

  it('turns an unknown kind into null with a warning, and a null kind too', () => {
    const unknown = normalizeIdDocumentScan(idRaw({ documentKind: 'Library Card' }), idCtx);
    expect(unknown.documentKind).toEqual({ value: null, confidence: 0 });
    expect(unknown.warnings).toEqual(['The document kind was not recognised; choose it by hand']);
    const none = normalizeIdDocumentScan(idRaw({ documentKind: null }), idCtx);
    expect(none.documentKind).toEqual({ value: null, confidence: 0 });
    expect(none.warnings).toEqual(['The document kind could not be determined; choose it by hand']);
  });

  it('is partial when every typed field is null', () => {
    const fields = Object.fromEntries(Object.keys(idRaw().fields).map((k) => [k, null]));
    expect(normalizeIdDocumentScan(idRaw({ fields }), idCtx).partial).toBe(true);
    expect(normalizeIdDocumentScan(idRaw(), idCtx).partial).toBe(false);
  });
});

describe('attributeKeyFromLabel', () => {
  it.each([
    ['Rx BIN', 'rx_bin'],
    ['Eye Colour ', 'eye_colour'],
    ['Résidence', 'residence'],
    ['4d Class', 'field_4d_class'],
    ['***', 'field'],
  ])('%s -> %s', (label, key) => {
    expect(attributeKeyFromLabel(label)).toBe(key);
  });
});
