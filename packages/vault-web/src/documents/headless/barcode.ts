// =============================================================================
// Driver license PDF417 (AAMVA) barcode: decoded in the browser (issue #214)
// =============================================================================
// US and Canadian driver licenses and state IDs carry a PDF417 barcode on the
// back that encodes the front's data in the AAMVA format. The browser decodes
// it from the original back photo and sends only the PARSED values with the
// extract request; the server compares them with the model's reading. The raw
// string and the image never leave the browser, and nothing is persisted.
//
// The decoder (@zxing/library) is loaded on demand by `decodePdf417` only, so
// it ships in its own chunk, never in the main bundle.
// =============================================================================

import {
  DOCUMENT_BARCODE_FIELD_MAX_LENGTH,
  type DocumentBarcode,
} from '@marinoscar/vault-contract/secrets';

/**
 * The values parsed from an AAMVA barcode. Dates are `YYYY-MM-DD`, `country`
 * is `USA` or `CAN`, `sex` is `M`, `F` or `X`; a missing element is absent.
 *
 * @stability experimental
 */
export interface AamvaFields {
  /** `DAQ`, the license or ID number. */
  documentNumber?: string;
  /** `DCS`. */
  familyName?: string;
  /** `DAC` and `DAD` (first and middle), or the older `DCT`. */
  givenNames?: string;
  /** `DBB`. */
  birthDate?: string;
  /** `DBA`. */
  expiryDate?: string;
  /** `DBD`. */
  issueDate?: string;
  /** `DAJ`, the two-letter jurisdiction code. */
  state?: string;
  /** `DCG`. */
  country?: string;
  /** `DBC`. */
  sex?: string;
  /** `DCA`. */
  licenseClass?: string;
  /** `DCB`. */
  restrictions?: string;
  /** `DCD`. */
  endorsements?: string;
  /** `DAG`, `DAH`, `DAI`, `DAJ` and `DAK` on one line. */
  address?: string;
}

/** An element id: `D` and two capital letters. */
const ELEMENT = /^D[A-Z]{2}$/;
/** Values the standard uses for "nothing here". */
const EMPTY_VALUES = new Set(['NONE', 'UNAVL', 'UNAVAIL', 'UNAVAILABLE', 'N/A', 'NA']);

const clean = (value: string | undefined): string | undefined => {
  const text = value?.replace(/\s+/g, ' ').trim();
  return text ? text : undefined;
};

const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isoDate(year: number, month: number, day: number): string | undefined {
  if (year < 1900 || year > 2199 || month < 1 || month > 12 || day < 1) return undefined;
  const max = month === 2 && isLeap(year) ? 29 : DAYS[month - 1];
  if (day > max) return undefined;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * An AAMVA date to `YYYY-MM-DD`: `MMDDCCYY` for the US, `CCYYMMDD` for Canada
 * (by `DCG`); when the expected order does not give a real date, the other one
 * is tried. `undefined` when neither does.
 */
function aamvaDate(value: string | undefined, canada: boolean): string | undefined {
  const digits = value?.trim();
  if (!digits || !/^\d{8}$/.test(digits)) return undefined;
  const n = (from: number, to: number) => Number(digits.slice(from, to));
  const us = () => isoDate(n(4, 8), n(0, 2), n(2, 4));
  const ca = () => isoDate(n(0, 4), n(4, 6), n(6, 8));
  return canada ? (ca() ?? us()) : (us() ?? ca());
}

function aamvaSex(value: string | undefined): string | undefined {
  switch (value?.trim().toUpperCase()) {
    case '1':
    case 'M':
      return 'M';
    case '2':
    case 'F':
      return 'F';
    case '9':
    case 'X':
      return 'X';
    default:
      return undefined;
  }
}

function postalCode(value: string | undefined): string | undefined {
  const code = clean(value);
  if (!code) return undefined;
  if (/^\d{9}$/.test(code)) return code.endsWith('0000') ? code.slice(0, 5) : `${code.slice(0, 5)}-${code.slice(5)}`;
  return code;
}

/**
 * Parses the text of a PDF417 barcode in the AAMVA format (the compliance
 * indicator `@`, the `ANSI ` or `AAMVA` header, then the `DL` or `ID`
 * subfile). Pure. `null` when the text is not an AAMVA barcode, or is too
 * truncated or garbled to carry the license number.
 *
 * Dates follow the country: `MMDDCCYY` for the US, `CCYYMMDD` for Canada.
 *
 * @stability experimental
 */
export function parseAamva(raw: string): AamvaFields | null {
  if (typeof raw !== 'string' || raw.length < 20) return null;
  const header = raw.search(/ANSI |AAMVA/);
  if (header < 0 || header > 10) return null;

  const elements = new Map<string, string>();
  const lines = raw.slice(header).split(/[\n\r\u001e\u001c\u001d]+/);
  for (const [index, original] of lines.entries()) {
    let line = original;
    if (index === 0) {
      // The header line ends with the first subfile: `...DL00410278ZV03190008DLDAQX1234567`.
      const start = line.search(/(?:DL|ID)(?=D[A-Z]{2})/);
      if (start < 0) continue;
      line = line.slice(start + 2);
    } else if (/^(?:DL|ID)D[A-Z]{2}/.test(line)) {
      line = line.slice(2);
    }
    const id = line.slice(0, 3);
    if (!ELEMENT.test(id) || elements.has(id)) continue;
    const value = clean(line.slice(3));
    if (value !== undefined) elements.set(id, value);
  }

  const get = (id: string): string | undefined => {
    const value = elements.get(id);
    return value === undefined || EMPTY_VALUES.has(value.toUpperCase()) ? undefined : value;
  };
  // The text kept as is (`NONE` is a real restriction or endorsement value).
  const raw3 = (id: string): string | undefined => elements.get(id);

  const documentNumber = get('DAQ');
  if (!documentNumber || !/^[A-Z0-9 -]{1,40}$/i.test(documentNumber)) return null;

  const country = get('DCG')?.toUpperCase();
  const canada = country === 'CAN';
  const given =
    get('DCT')?.replace(/,+/g, ' ').replace(/\s+/g, ' ').trim() ||
    [get('DAC'), get('DAD')].filter(Boolean).join(' ');
  const state = get('DAJ')?.toUpperCase();
  const address = [
    [get('DAG'), get('DAH')].filter(Boolean).join(' '),
    get('DAI'),
    [state, postalCode(get('DAK'))].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');

  const fields: AamvaFields = {
    documentNumber,
    familyName: get('DCS'),
    givenNames: given || undefined,
    birthDate: aamvaDate(get('DBB'), canada),
    expiryDate: aamvaDate(get('DBA'), canada),
    issueDate: aamvaDate(get('DBD'), canada),
    state: state && /^[A-Z]{2}$/.test(state) ? state : undefined,
    country: country === 'USA' || country === 'CAN' ? country : undefined,
    sex: aamvaSex(get('DBC')),
    licenseClass: get('DCA'),
    restrictions: raw3('DCB'),
    endorsements: raw3('DCD'),
    address: address || undefined,
  };
  for (const key of Object.keys(fields) as Array<keyof AamvaFields>) {
    if (fields[key] === undefined) delete fields[key];
  }
  return fields;
}

/**
 * The `barcode` of the extract request: the parsed fields, each capped at
 * {@link DOCUMENT_BARCODE_FIELD_MAX_LENGTH} characters. The address is not
 * sent (the server does not cross-check it).
 *
 * @stability experimental
 */
export function toDocumentBarcode(fields: AamvaFields): DocumentBarcode {
  const { address: _address, ...rest } = fields;
  const out: DocumentBarcode['fields'] = {};
  for (const [key, value] of Object.entries(rest) as Array<[keyof DocumentBarcode['fields'], string | undefined]>) {
    if (value) out[key] = value.slice(0, DOCUMENT_BARCODE_FIELD_MAX_LENGTH);
  }
  return { format: 'aamva', fields: out };
}

/** The decoder module, loaded on demand (its own chunk). */
export type Pdf417DecoderModule = typeof import('./pdf417Decoder.js');

/**
 * Loads the PDF417 decoder. A dynamic import, so a bundler splits
 * `@zxing/library` into a chunk fetched only when a scan decodes a barcode.
 *
 * @stability experimental
 */
export function loadPdf417Decoder(): Promise<Pdf417DecoderModule> {
  return import('./pdf417Decoder.js');
}

/**
 * Decodes the PDF417 barcode in a photo: pass the ORIGINAL full-resolution
 * file, before any crop or downscale. Loads the decoder on first use. Resolves
 * to the barcode text, or `null` when there is none, it cannot be read or the
 * decoder fails to load. Never rejects.
 *
 * @stability experimental
 */
export async function decodePdf417(file: File): Promise<string | null> {
  try {
    const decoder = await loadPdf417Decoder();
    const text = await decoder.decodePdf417Image(file);
    return typeof text === 'string' && text !== '' ? text : null;
  } catch {
    return null;
  }
}

/**
 * Decodes and parses the AAMVA barcode of a back photo into the request's
 * `barcode`: `null` when there is no readable AAMVA barcode. Never rejects.
 *
 * @stability experimental
 */
export async function readDriverLicenseBarcode(file: File): Promise<DocumentBarcode | null> {
  const text = await decodePdf417(file);
  if (text === null) return null;
  const fields = parseAamva(text);
  return fields ? toDocumentBarcode(fields) : null;
}
