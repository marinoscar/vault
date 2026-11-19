// Fixtures are invented: the ICAO 9303 specimen state UTO and its specimen
// holder (ERIKSSON, ANNA MARIA), invalid-by-construction SSNs and made-up VINs.
import {
  AAMVA_JURISDICTIONS,
  COUNTRY_CODES,
  COUNTRY_TABLE,
  checkSsn,
  checkVin,
  isCountryCode,
  isMrzCountryCode,
  jurisdictionAgrees,
  mrzCheckDigit,
  mrzDate,
  normalizeDate,
  parseMrz,
  toAlpha3,
  vinCheckDigit,
} from './index';

const TODAY = new Date(Date.UTC(2010, 0, 1));
const TD3 = [
  'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
  'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
];
const TD2 = ['I<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<', 'D231458907UTO7408122F1204159<<<<<<<6'];
const TD1 = [
  'I<UTOD231458907<<<<<<<<<<<<<<<',
  '7408122F1204159UTO<<<<<<<<<<<6',
  'ERIKSSON<<ANNA<MARIA<<<<<<<<<<',
];

const set = (line: string, i: number, ch: string): string =>
  line.slice(0, i) + ch + line.slice(i + 1);
const pad = (s: string, n: number): string => s + '<'.repeat(n - s.length);
const failed = (r: ReturnType<typeof parseMrz>): string[] =>
  r!.checks.filter((c) => !c.ok).map((c) => c.field);

describe('mrzCheckDigit', () => {
  it('matches the ICAO 9303 worked examples', () => {
    expect(mrzCheckDigit('L898902C3')).toBe(6);
    expect(mrzCheckDigit('740812')).toBe(2);
    expect(mrzCheckDigit('120415')).toBe(9);
    expect(mrzCheckDigit('ZE184226B<<<<<')).toBe(1);
    expect(mrzCheckDigit('')).toBe(0);
  });

  it('rejects characters outside the MRZ set', () => {
    expect(() => mrzCheckDigit('AB-1')).toThrow(RangeError);
  });
});

describe('parseMrz', () => {
  it('parses a TD3 specimen', () => {
    const r = parseMrz(TD3.join('\n'), { today: TODAY });
    expect(r).toEqual({
      format: 'TD3',
      documentCode: 'P',
      issuingCountry: 'UTO',
      documentNumber: 'L898902C3',
      nationality: 'UTO',
      birthDate: '1974-08-12',
      sex: 'F',
      expiryDate: '2012-04-15',
      surname: 'ERIKSSON',
      givenNames: 'ANNA MARIA',
      personalNumber: 'ZE184226B',
      checks: [
        { field: 'documentNumber', ok: true },
        { field: 'birthDate', ok: true },
        { field: 'expiryDate', ok: true },
        { field: 'personalNumber', ok: true },
        { field: 'composite', ok: true },
      ],
      valid: true,
    });
  });

  it('parses a TD2 specimen', () => {
    const r = parseMrz(TD2.join('\n'), { today: TODAY })!;
    expect(r).toMatchObject({
      format: 'TD2',
      documentCode: 'I',
      documentNumber: 'D23145890',
      personalNumber: null,
      valid: true,
    });
    expect(r.checks.map((c) => c.field)).toEqual([
      'documentNumber',
      'birthDate',
      'expiryDate',
      'composite',
    ]);
  });

  it('parses a TD1 specimen', () => {
    const r = parseMrz(TD1.join('\n'), { today: TODAY })!;
    expect(r).toMatchObject({
      format: 'TD1',
      documentNumber: 'D23145890',
      surname: 'ERIKSSON',
      givenNames: 'ANNA MARIA',
      birthDate: '1974-08-12',
      expiryDate: '2012-04-15',
      sex: 'F',
      personalNumber: null,
      valid: true,
    });
  });

  it('tolerates spaces, lower case, CRLF, blank lines and the « filler', () => {
    const text = `\n${TD3[0].replace(/</g, '«').toLowerCase()}\r\n${TD3[1].slice(
      0,
      20
    )} ${TD3[1].slice(20)}\n\n`;
    expect(parseMrz(text, { today: TODAY })?.valid).toBe(true);
  });

  it('uses the current date by default', () => {
    expect(parseMrz(TD3.join('\n'))?.birthDate).toBe('1974-08-12');
  });

  it.each([
    [9, 'documentNumber'],
    [19, 'birthDate'],
    [27, 'expiryDate'],
    [42, 'personalNumber'],
  ])('flags a corrupted TD3 check digit at %i as %s', (pos, field) => {
    const r = parseMrz([TD3[0], set(TD3[1], pos, TD3[1][pos] === '7' ? '8' : '7')].join('\n'), {
      today: TODAY,
    });
    expect(failed(r)).toEqual([field, 'composite']);
    expect(r!.valid).toBe(false);
  });

  it('flags a corrupted composite check digit', () => {
    expect(failed(parseMrz([TD3[0], set(TD3[1], 43, '1')].join('\n'), { today: TODAY }))).toEqual([
      'composite',
    ]);
  });

  it('flags corrupted TD1 and TD2 check digits', () => {
    expect(
      failed(parseMrz([set(TD1[0], 14, '8'), TD1[1], TD1[2]].join('\n'), { today: TODAY }))
    ).toEqual(['documentNumber', 'composite']);
    expect(
      failed(parseMrz([TD1[0], set(TD1[1], 6, '3'), TD1[2]].join('\n'), { today: TODAY }))
    ).toEqual(['birthDate', 'composite']);
    expect(failed(parseMrz([TD2[0], set(TD2[1], 27, '1')].join('\n'), { today: TODAY }))).toEqual([
      'expiryDate',
      'composite',
    ]);
    expect(failed(parseMrz([TD2[0], set(TD2[1], 35, 'A')].join('\n'), { today: TODAY }))).toEqual([
      'composite',
    ]);
  });

  it('repairs O to 0 in a date and a check digit, never in a name', () => {
    const line2 = set(TD3[1], 15, 'O');
    const r = parseMrz([TD3[0], set(line2, 43, 'O')].join('\n'), { today: TODAY })!;
    expect(r.birthDate).toBe('1974-08-12');
    expect(r.surname).toBe('ERIKSSON');
    expect(r.valid).toBe(true);
  });

  it('repairs I, B and S in numeric positions', () => {
    // expiry 120415 check 9: write the date as I2O4IS
    const r = parseMrz([TD3[0], TD3[1].slice(0, 21) + 'I2O4IS' + TD3[1].slice(27)].join('\n'), {
      today: TODAY,
    })!;
    expect(r.expiryDate).toBe('2012-04-15');
    expect(r.valid).toBe(true);
  });

  it('checks an empty TD3 personal number only when its check is not a filler', () => {
    const empty = TD3[1].slice(0, 28) + '<'.repeat(15);
    const composite = (l: string): number =>
      mrzCheckDigit(l.slice(0, 10) + l.slice(13, 20) + l.slice(21, 43));
    const withFiller = empty + composite(empty + '<');
    const r1 = parseMrz([TD3[0], withFiller].join('\n'), { today: TODAY })!;
    expect(r1.checks.map((c) => c.field)).not.toContain('personalNumber');
    expect(r1).toMatchObject({ personalNumber: null, valid: true });

    const zero = TD3[1].slice(0, 28) + '<'.repeat(14) + '0';
    const r2 = parseMrz([TD3[0], zero + composite(zero)].join('\n'), { today: TODAY })!;
    expect(r2.checks).toContainEqual({ field: 'personalNumber', ok: true });
    expect(r2.valid).toBe(true);
  });

  it('accepts a filler check digit only where the check value is 0', () => {
    const l2 = set(TD3[1], 9, '<');
    expect(failed(parseMrz([TD3[0], l2].join('\n'), { today: TODAY }))).toContain('documentNumber');
  });

  it('reads sex X and an unspecified sex', () => {
    const fix = (sex: string) => {
      const l = set(TD3[1], 20, sex);
      return parseMrz([TD3[0], l].join('\n'), { today: TODAY })!.sex;
    };
    expect(fix('M')).toBe('M');
    expect(fix('X')).toBe('X');
    expect(fix('<')).toBeNull();
  });

  it('follows a long TD1 document number into the optional data', () => {
    const number = 'D23145890734';
    const l1 = pad(
      `I<UTO${number.slice(0, 9)}<${number.slice(9)}${mrzCheckDigit(number)}<AB12`,
      30
    );
    const l2 = '7408122F1204159UTO<<<<<<<<<<<';
    const composite = mrzCheckDigit(
      l1.slice(5, 30) + l2.slice(0, 7) + l2.slice(8, 15) + l2.slice(18, 29)
    );
    const r = parseMrz([l1, l2.slice(0, 29) + composite, TD1[2]].join('\n'), { today: TODAY })!;
    expect(r).toMatchObject({ documentNumber: number, personalNumber: 'AB12', valid: true });
  });

  it('follows a long TD2 document number that fills the optional data', () => {
    const number = 'D23145890123456';
    const tail = `${number.slice(9)}${mrzCheckDigit(number)}`;
    const body = `${number.slice(0, 9)}<UTO7408122F1204159${tail}`;
    const composite = mrzCheckDigit(body.slice(0, 10) + body.slice(13, 20) + body.slice(21, 35));
    const r = parseMrz([TD2[0], body + composite].join('\n'), { today: TODAY })!;
    expect(r).toMatchObject({ documentNumber: number, personalNumber: null, valid: true });
  });

  it('keeps TD1 optional data as the personal number', () => {
    const l1 = pad('I<UTOD231458907XY<9', 30);
    const l2 = '7408122F1204159UTO<<<<<<<<<<<';
    const composite = mrzCheckDigit(
      l1.slice(5, 30) + l2.slice(0, 7) + l2.slice(8, 15) + l2.slice(18, 29)
    );
    const r = parseMrz([l1, l2.slice(0, 29) + composite, TD1[2]].join('\n'), { today: TODAY })!;
    expect(r).toMatchObject({ documentNumber: 'D23145890', personalNumber: 'XY 9', valid: true });
  });

  it('returns null for random text and malformed zones', () => {
    expect(parseMrz('The quick brown fox\njumps over the lazy dog')).toBeNull();
    expect(parseMrz('')).toBeNull();
    expect(parseMrz(TD3[0])).toBeNull();
    expect(parseMrz(`${TD3[0]}\n${TD3[1].slice(0, 43)}`)).toBeNull();
    expect(parseMrz(`${TD3[0]}\n${set(TD3[1], 3, '#')}`)).toBeNull();
    expect(parseMrz(`${set(TD3[0], 0, '1')}\n${TD3[1]}`)).toBeNull();
  });
});

describe('normalizeDate', () => {
  it.each([
    ['2025-03-04', '2025-03-04'],
    ['2025-02-30', null],
    ['04 MAR 2025', '2025-03-04'],
    ['4 mar. 2025', '2025-03-04'],
    ['04-Mar-2025', '2025-03-04'],
    ['04 MAR/MARS 2025', '2025-03-04'],
    ['4 September 2025', '2025-09-04'],
    ['04 MAX 2025', null],
    ['31 FEB 2025', null],
    ['25/12/2025', '2025-12-25'],
    ['12/25/2025', '2025-12-25'],
    ['03/03/2025', '2025-03-03'],
    ['03/04/2025', null],
    ['13/14/2025', null],
    ['yesterday', null],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeDate(input)).toBe(expected);
  });
});

describe('mrzDate', () => {
  const today = new Date(Date.UTC(2026, 10, 19));

  it('never puts a birth date in the future', () => {
    expect(mrzDate('991231', 'birth', today)).toBe('1999-12-31');
    expect(mrzDate('050101', 'birth', today)).toBe('2005-01-01');
    expect(mrzDate('261119', 'birth', today)).toBe('2026-11-19');
    expect(mrzDate('261120', 'birth', today)).toBe('1926-11-20');
  });

  it('places an expiry date between 10 years before and 20 years after today', () => {
    expect(mrzDate('301231', 'expiry', today)).toBe('2030-12-31');
    expect(mrzDate('170101', 'expiry', today)).toBe('2017-01-01');
    expect(mrzDate('460101', 'expiry', today)).toBe('2046-01-01');
    expect(mrzDate('600101', 'expiry', today)).toBeNull();
    expect(mrzDate('050101', 'expiry', new Date(Date.UTC(2095, 0, 1)))).toBe('2105-01-01');
    expect(mrzDate('950101', 'expiry', new Date(Date.UTC(2003, 0, 1)))).toBe('1995-01-01');
  });

  it('rejects malformed and impossible dates', () => {
    expect(mrzDate('99123', 'birth', today)).toBeNull();
    expect(mrzDate('9912A1', 'birth', today)).toBeNull();
    expect(mrzDate('991340', 'birth', today)).toBeNull();
    expect(mrzDate('301340', 'expiry', today)).toBeNull();
  });

  it('defaults today to now', () => {
    expect(mrzDate('000101', 'birth')).toBe('2000-01-01');
  });
});

describe('checkSsn', () => {
  it.each([
    ['000-12-3456', 'area'],
    ['666-12-3456', 'area'],
    ['912-12-3456', 'area'],
    ['123-00-4567', 'group'],
    ['123-45-0000', 'serial'],
    ['12-345-6789', 'format'],
    ['123-456789', 'format'],
    ['abc', 'format'],
  ])('rejects %s (%s)', (value, reason) => {
    expect(checkSsn(value)).toMatchObject({ ok: false, reason });
  });

  it('accepts a structurally valid invented number in either form', () => {
    expect(checkSsn('123-45-6789')).toEqual({ normalized: '123-45-6789', ok: true });
    expect(checkSsn(' 123456789 ')).toEqual({ normalized: '123-45-6789', ok: true });
    expect(checkSsn('abc').normalized).toBeNull();
  });
});

describe('checkVin', () => {
  // Invented: a made-up manufacturer prefix and serial.
  const withCheck = (body: string): string => set(body, 8, vinCheckDigit(body));

  it('accepts an invented VIN whose check digit is computed', () => {
    const vin = withCheck('5ZZTSTVN0AX123456');
    expect(checkVin(vin)).toEqual({ normalized: vin, ok: true });
    expect(checkVin(` ${vin.toLowerCase().slice(0, 8)} ${vin.slice(8).toLowerCase()}`)).toEqual({
      normalized: vin,
      ok: true,
    });
  });

  it('rejects a wrong check digit', () => {
    const vin = withCheck('5ZZTSTVN0AX123456');
    const wrong = set(vin, 8, vin[8] === '1' ? '2' : '1');
    expect(checkVin(wrong)).toEqual({ normalized: wrong, ok: false, reason: 'check' });
  });

  it('handles an X check digit', () => {
    let vin = '';
    for (let n = 0; n < 1000 && !vin; n += 1) {
      const candidate = `5ZZTSTVN0AX${String(n).padStart(6, '0')}`;
      if (vinCheckDigit(candidate) === 'X') vin = withCheck(candidate);
    }
    expect(vin[8]).toBe('X');
    expect(checkVin(vin).ok).toBe(true);
  });

  it.each(['5ZZTSTVN0AX12345', '5ZZTSTVN0AI123456', '5ZZTSTVN0AO123456', '5ZZTSTVN0AQ123456'])(
    'rejects the format of %s',
    (value) => {
      expect(checkVin(value)).toEqual({ normalized: null, ok: false, reason: 'format' });
    }
  );
});

describe('country', () => {
  it('round-trips alpha-2, alpha-3 and names', () => {
    expect(toAlpha3('fr')).toBe('FRA');
    expect(toAlpha3('FRA')).toBe('FRA');
    expect(toAlpha3('france')).toBe('FRA');
  });

  it('maps the MRZ D to DEU and accepts UTO', () => {
    expect(toAlpha3('D')).toBe('DEU');
    expect(isCountryCode('UTO')).toBe(true);
    expect(COUNTRY_CODES).toContain('UTO');
    expect(COUNTRY_TABLE.find((c) => c.alpha3 === 'UTO')?.alpha2).toBeNull();
    expect(isMrzCountryCode('D')).toBe(true);
    expect(isMrzCountryCode('UTO')).toBe(true);
    expect(isMrzCountryCode('QQQ')).toBe(false);
  });
});

describe('jurisdictionAgrees (issue #214)', () => {
  it('matches the code as a word, or the full name of a known code', () => {
    expect(jurisdictionAgrees('ZZ', 'ZZ')).toBe(true);
    expect(jurisdictionAgrees('zz dmv', 'ZZ')).toBe(true);
    expect(jurisdictionAgrees('State of Ohio', 'OH')).toBe(true);
    expect(jurisdictionAgrees('Québec', 'QC')).toBe(true);
    expect(jurisdictionAgrees('New York State', 'NY')).toBe(true);
  });

  it('refuses another jurisdiction or a partial word', () => {
    expect(jurisdictionAgrees('ZY', 'ZZ')).toBe(false);
    expect(jurisdictionAgrees('York', 'NY')).toBe(false);
    expect(jurisdictionAgrees('Department of Motor Vehicles', 'ZZ')).toBe(false);
    expect(AAMVA_JURISDICTIONS.ZZ).toBeUndefined();
  });
});
