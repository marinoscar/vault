// =============================================================================
// Machine-readable zone parser (ICAO 9303 TD1, TD2, TD3; pure, no I/O)
// =============================================================================

import { mrzDate } from './dates';

/** @stability experimental */
export type MrzFormat = 'TD1' | 'TD2' | 'TD3';

/** @stability experimental */
export type MrzCheckField =
  | 'documentNumber'
  | 'birthDate'
  | 'expiryDate'
  | 'personalNumber'
  | 'composite';

/** @stability experimental */
export interface MrzParseResult {
  format: MrzFormat;
  /** e.g. `P`, `C1`, `I`, `V` (fillers removed). */
  documentCode: string;
  /** Alpha-3 as printed (`D` for Germany, `UTO` in specimens), fillers removed. */
  issuingCountry: string;
  /** Fillers removed; a TD1/TD2 long number includes its continuation. */
  documentNumber: string;
  nationality: string;
  /** `YYYY-MM-DD`, see {@link mrzDate}. */
  birthDate: string | null;
  sex: 'M' | 'F' | 'X' | null;
  expiryDate: string | null;
  surname: string;
  givenNames: string;
  /** TD3 personal number, or the TD1/TD2 optional data; `null` when empty. */
  personalNumber: string | null;
  checks: { field: MrzCheckField; ok: boolean }[];
  /** `true` when every present check is ok. */
  valid: boolean;
}

/** @stability experimental */
export interface MrzParseOptions {
  /** Reference day for the date century rule (defaults to now). */
  today?: Date;
}

const WEIGHTS = [7, 3, 1];

/**
 * ICAO 9303 check digit: weights 7-3-1 repeating, `0`-`9` as is, `A`=10 ...
 * `Z`=35, `<`=0. Throws a `RangeError` on any other character.
 *
 * @stability experimental
 */
export function mrzCheckDigit(s: string): number {
  let sum = 0;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    let value: number;
    if (ch >= '0' && ch <= '9') value = ch.charCodeAt(0) - 48;
    else if (ch >= 'A' && ch <= 'Z') value = ch.charCodeAt(0) - 55;
    else if (ch === '<') value = 0;
    else throw new RangeError(`Not an MRZ character at ${i}`);
    sum += value * WEIGHTS[i % 3];
  }
  return sum % 10;
}

/** OCR repair for positions that can only hold digits. Never used on names. */
function digits(s: string): string {
  return s.replace(/O/g, '0').replace(/I/g, '1').replace(/B/g, '8').replace(/S/g, '5');
}

function strip(s: string): string {
  return s.replace(/<+$/, '').replace(/^<+/, '');
}

/** Does the (repaired) check character match the field? */
function checkOk(field: string, checkChar: string): boolean {
  const c = digits(checkChar);
  const expected = mrzCheckDigit(field);
  if (c === '<') return expected === 0;
  return /^\d$/.test(c) && Number(c) === expected;
}

function names(field: string): { surname: string; givenNames: string } {
  const [surname, ...rest] = field.split('<<');
  const clean = (s: string): string => s.replace(/</g, ' ').replace(/\s+/g, ' ').trim();
  return { surname: clean(surname), givenNames: clean(rest.join(' ')) };
}

function sexOf(c: string): MrzParseResult['sex'] {
  return c === 'M' || c === 'F' || c === 'X' ? c : null;
}

/**
 * Splits a document number field and its check character, following a long
 * number (more than nine characters) into the optional data when the check
 * position holds `<` (TD1 and TD2). Returns the number, the string the check
 * covers, its check character and the rest of the optional data.
 */
function documentNumber(
  field: string,
  checkChar: string,
  optional: string
): { number: string; checked: string; checkChar: string; optionalRest: string } {
  const continuation = /^([A-Z0-9]*?)([0-9OIBS])(<.*)?$/.exec(optional);
  if (checkChar === '<' && continuation && continuation[1] !== '') {
    return {
      number: field + continuation[1],
      checked: field + continuation[1],
      checkChar: continuation[2],
      optionalRest: continuation[3] ?? '',
    };
  }
  return { number: strip(field), checked: field, checkChar, optionalRest: optional };
}

function joinOptional(...parts: string[]): string | null {
  const text = parts
    .map((p) => strip(p).replace(/</g, ' ').trim())
    .filter((p) => p !== '')
    .join(' ');
  return text === '' ? null : text;
}

/**
 * Normalises MRZ text: `«` becomes `<`, spaces inside a line are dropped,
 * letters are upper-cased and empty lines are ignored.
 */
function normaliseLines(text: string): string[] {
  return text
    .replace(/«/g, '<')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, '').toUpperCase())
    .filter((l) => l !== '');
}

/**
 * Parses an MRZ given as its lines joined by `\n`. The format comes from the
 * line count and lengths (TD1 3x30, TD2 2x36, TD3 2x44); `null` when nothing
 * matches. Numeric positions (check digits, dates) are OCR-repaired
 * (`O`->`0`, `I`->`1`, `B`->`8`, `S`->`5`); name fields never are.
 *
 * @stability experimental
 */
export function parseMrz(text: string, options: MrzParseOptions = {}): MrzParseResult | null {
  const lines = normaliseLines(text);
  if (lines.some((l) => !/^[A-Z0-9<]+$/.test(l))) return null;
  const today = options.today ?? new Date();
  const lengths = lines.map((l) => l.length).join(',');
  if (lengths === '30,30,30') return parseTd1(lines, today);
  if (lengths === '36,36') return parseTd2(lines, today);
  if (lengths === '44,44') return parseTd3(lines, today);
  return null;
}

function finish(
  base: Omit<MrzParseResult, 'checks' | 'valid'>,
  checks: MrzParseResult['checks']
): MrzParseResult | null {
  if (!/^[A-Z]/.test(base.documentCode)) return null;
  return { ...base, checks, valid: checks.every((c) => c.ok) };
}

function parseTd3(lines: string[], today: Date): MrzParseResult | null {
  const [l1, l2] = lines;
  const birth = digits(l2.slice(13, 19));
  const expiry = digits(l2.slice(21, 27));
  const personal = l2.slice(28, 42);
  const composite =
    l2.slice(0, 9) +
    digits(l2[9]) +
    birth +
    digits(l2[19]) +
    expiry +
    digits(l2[27]) +
    personal +
    digits(l2[42]);
  const checks: MrzParseResult['checks'] = [
    { field: 'documentNumber', ok: checkOk(l2.slice(0, 9), l2[9]) },
    { field: 'birthDate', ok: checkOk(birth, l2[19]) },
    { field: 'expiryDate', ok: checkOk(expiry, l2[27]) },
  ];
  if (strip(personal) !== '' || l2[42] !== '<') {
    checks.push({ field: 'personalNumber', ok: checkOk(personal, l2[42]) });
  }
  checks.push({ field: 'composite', ok: checkOk(composite, l2[43]) });
  return finish(
    {
      format: 'TD3',
      documentCode: strip(l1.slice(0, 2)),
      issuingCountry: strip(l1.slice(2, 5)),
      documentNumber: strip(l2.slice(0, 9)),
      nationality: strip(l2.slice(10, 13)),
      birthDate: mrzDate(birth, 'birth', today),
      sex: sexOf(l2[20]),
      expiryDate: mrzDate(expiry, 'expiry', today),
      ...names(l1.slice(5)),
      personalNumber: joinOptional(personal),
    },
    checks
  );
}

function parseTd2(lines: string[], today: Date): MrzParseResult | null {
  const [l1, l2] = lines;
  const birth = digits(l2.slice(13, 19));
  const expiry = digits(l2.slice(21, 27));
  const doc = documentNumber(l2.slice(0, 9), l2[9], l2.slice(28, 35));
  const composite =
    l2.slice(0, 9) +
    digits(l2[9]) +
    birth +
    digits(l2[19]) +
    expiry +
    digits(l2[27]) +
    l2.slice(28, 35);
  return finish(
    {
      format: 'TD2',
      documentCode: strip(l1.slice(0, 2)),
      issuingCountry: strip(l1.slice(2, 5)),
      documentNumber: doc.number,
      nationality: strip(l2.slice(10, 13)),
      birthDate: mrzDate(birth, 'birth', today),
      sex: sexOf(l2[20]),
      expiryDate: mrzDate(expiry, 'expiry', today),
      ...names(l1.slice(5)),
      personalNumber: joinOptional(doc.optionalRest),
    },
    [
      { field: 'documentNumber', ok: checkOk(doc.checked, doc.checkChar) },
      { field: 'birthDate', ok: checkOk(birth, l2[19]) },
      { field: 'expiryDate', ok: checkOk(expiry, l2[27]) },
      { field: 'composite', ok: checkOk(composite, l2[35]) },
    ]
  );
}

function parseTd1(lines: string[], today: Date): MrzParseResult | null {
  const [l1, l2, l3] = lines;
  const birth = digits(l2.slice(0, 6));
  const expiry = digits(l2.slice(8, 14));
  const doc = documentNumber(l1.slice(5, 14), l1[14], l1.slice(15, 30));
  const composite =
    l1.slice(5, 30) + birth + digits(l2[6]) + expiry + digits(l2[14]) + l2.slice(18, 29);
  return finish(
    {
      format: 'TD1',
      documentCode: strip(l1.slice(0, 2)),
      issuingCountry: strip(l1.slice(2, 5)),
      documentNumber: doc.number,
      nationality: strip(l2.slice(15, 18)),
      birthDate: mrzDate(birth, 'birth', today),
      sex: sexOf(l2[7]),
      expiryDate: mrzDate(expiry, 'expiry', today),
      ...names(l3),
      personalNumber: joinOptional(doc.optionalRest, l2.slice(18, 29)),
    },
    [
      { field: 'documentNumber', ok: checkOk(doc.checked, doc.checkChar) },
      { field: 'birthDate', ok: checkOk(birth, l2[6]) },
      { field: 'expiryDate', ok: checkOk(expiry, l2[14]) },
      { field: 'composite', ok: checkOk(composite, l2[29]) },
    ]
  );
}
