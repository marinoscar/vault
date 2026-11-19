// Issue #214: the driver license PDF417 (AAMVA) barcode, decoded in the browser.
// Invented values only: Person A, the made-up number X1234567, the placeholder
// jurisdiction ZZ and the placeholder issuer number 999999. The decoder is mocked.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const decoder = vi.hoisted(() => ({
  loads: 0,
  decodePdf417Image: vi.fn<(file: Blob) => Promise<string | null>>(),
}));

vi.mock('../../src/documents/headless/pdf417Decoder.js', () => {
  decoder.loads += 1;
  return { decodePdf417Image: decoder.decodePdf417Image };
});

import {
  decodePdf417,
  parseAamva,
  readDriverLicenseBarcode,
  toDocumentBarcode,
} from '../../src/documents/headless/barcode.js';

/** An AAMVA barcode text: the compliance indicator, the header, the DL subfile, a jurisdiction subfile. */
function aamva(elements: string[], header = '@\n\u001e\rANSI 999999100002DL00410278ZZ03190008'): string {
  return `${header}DL${elements.join('\n')}\r\nZZZZA0\r`;
}

const US = aamva([
  'DAQX1234567',
  'DCSA',
  'DACPERSON',
  'DADNONE',
  'DBD01312022',
  'DBB01311990',
  'DBA01312030',
  'DBC2',
  'DAG123 EXAMPLE ST',
  'DAIANYTOWN',
  'DAJZZ',
  'DAK000010000',
  'DCGUSA',
  'DCAC',
  'DCBNONE',
  'DCDNONE',
]);

const CANADA = aamva([
  'DAQX1234567',
  'DCSA',
  'DCTPERSON,MIDDLE',
  'DBD20220131',
  'DBB19900131',
  'DBA20300131',
  'DBC1',
  'DAJZZ',
  'DCGCAN',
  'DCA5',
]);

describe('parseAamva', () => {
  it('parses a US barcode, MMDDCCYY dates', () => {
    expect(parseAamva(US)).toEqual({
      documentNumber: 'X1234567',
      familyName: 'A',
      givenNames: 'PERSON',
      birthDate: '1990-01-31',
      expiryDate: '2030-01-31',
      issueDate: '2022-01-31',
      state: 'ZZ',
      country: 'USA',
      sex: 'F',
      licenseClass: 'C',
      restrictions: 'NONE',
      endorsements: 'NONE',
      address: '123 EXAMPLE ST, ANYTOWN, ZZ 00001',
    });
  });

  it('parses a Canadian barcode, CCYYMMDD dates, and the older DCT given names', () => {
    expect(parseAamva(CANADA)).toEqual({
      documentNumber: 'X1234567',
      familyName: 'A',
      givenNames: 'PERSON MIDDLE',
      birthDate: '1990-01-31',
      expiryDate: '2030-01-31',
      issueDate: '2022-01-31',
      state: 'ZZ',
      country: 'CAN',
      sex: 'M',
      licenseClass: '5',
      address: 'ZZ',
    });
  });

  it('falls back to the other date order when the expected one is not a date', () => {
    const fields = parseAamva(aamva(['DAQX1234567', 'DCGUSA', 'DBB19900131', 'DBA02302030']));
    expect(fields?.birthDate).toBe('1990-01-31');
    // 30 February in either order: dropped, not guessed.
    expect(fields).not.toHaveProperty('expiryDate');
  });

  it('accepts the subfile designator on its own line and the AAMVA header of version 1', () => {
    const text = '@\n\u001e\rAAMVA999999010101DL00290190\nDLDAQX1234567\nDCSA\nDACPERSON\nDBB19900131\nDCGCAN';
    expect(parseAamva(text)).toMatchObject({ documentNumber: 'X1234567', familyName: 'A', birthDate: '1990-01-31' });
  });

  it('keeps the first value of a repeated element and ignores jurisdiction elements', () => {
    const fields = parseAamva(aamva(['DAQX1234567', 'DAQZ9999999', 'ZZAJURISDICTION']));
    expect(fields).toEqual({ documentNumber: 'X1234567' });
  });

  it.each([
    ['empty', ''],
    ['not a string', 42 as unknown as string],
    ['a QR payload', 'https://example.test/some/where/else'],
    ['truncated before the number', '@\n\u001e\rANSI 999999100002DL00410278'],
    ['the header far from the start', `${'x'.repeat(40)}${US}`],
    ['garbled', '@\n\u001e\rANSI 99999\u0000\u0007DLDA?#\n\u0001\u0002'],
    ['a number that is not one', aamva(['DAQ<<script>>', 'DCSA'])],
  ])('returns null for %s input', (_name, text) => {
    expect(parseAamva(text)).toBeNull();
  });
});

describe('toDocumentBarcode', () => {
  it('drops the address and caps each value at 200 characters', () => {
    const barcode = toDocumentBarcode({ documentNumber: 'X1234567', familyName: 'A'.repeat(250), address: '123 EXAMPLE ST' });
    expect(barcode).toEqual({ format: 'aamva', fields: { documentNumber: 'X1234567', familyName: 'A'.repeat(200) } });
  });
});

describe('decodePdf417 (lazy)', () => {
  const file = new File(['back-bytes'], 'back.jpg', { type: 'image/jpeg' });

  beforeEach(() => {
    decoder.decodePdf417Image.mockReset();
  });

  it('loads the decoder only on the first decode', async () => {
    // Importing barcode.js (above) did not load it.
    expect(decoder.loads).toBe(0);
    decoder.decodePdf417Image.mockResolvedValue(US);
    await expect(decodePdf417(file)).resolves.toBe(US);
    expect(decoder.loads).toBe(1);
    expect(decoder.decodePdf417Image).toHaveBeenCalledWith(file);
  });

  it('returns null on undecodable input and never rejects', async () => {
    decoder.decodePdf417Image.mockResolvedValueOnce(null);
    await expect(decodePdf417(file)).resolves.toBeNull();
    decoder.decodePdf417Image.mockResolvedValueOnce('');
    await expect(decodePdf417(file)).resolves.toBeNull();
    decoder.decodePdf417Image.mockRejectedValueOnce(new Error('not an image'));
    await expect(decodePdf417(file)).resolves.toBeNull();
  });

  it('reads a driver license barcode into the request shape, or null', async () => {
    decoder.decodePdf417Image.mockResolvedValueOnce(US);
    const barcode = await readDriverLicenseBarcode(file);
    expect(barcode?.format).toBe('aamva');
    expect(barcode?.fields).toMatchObject({ documentNumber: 'X1234567', state: 'ZZ', birthDate: '1990-01-31' });
    expect(JSON.stringify(barcode)).not.toContain('ANSI');
    decoder.decodePdf417Image.mockResolvedValueOnce('https://example.test/qr');
    await expect(readDriverLicenseBarcode(file)).resolves.toBeNull();
  });
});

describe('the decoder stays out of the main chunk', () => {
  const SRC = join(__dirname, '../../src');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
    });

  it('imports @zxing/library from pdf417Decoder.ts only, which only a dynamic import loads', () => {
    const zxing: string[] = [];
    const staticDecoder: string[] = [];
    for (const path of files(SRC)) {
      const source = readFileSync(path, 'utf8');
      const rel = relative(SRC, path).split('\\').join('/');
      if (/from\s+['"]@zxing\//.test(source) || /import\(\s*['"]@zxing\//.test(source)) zxing.push(rel);
      if (/(?:^|\n)\s*(?:import|export)[^;]*?from\s+['"][^'"]*pdf417Decoder(?:\.js)?['"]/.test(source)) {
        // A type-only import is erased at build time.
        if (!/(?:^|\n)\s*import\s+type\b[^;]*pdf417Decoder/.test(source)) staticDecoder.push(rel);
      }
    }
    expect(zxing).toEqual(['documents/headless/pdf417Decoder.ts']);
    expect(staticDecoder).toEqual([]);
    expect(readFileSync(join(SRC, 'documents/headless/barcode.ts'), 'utf8')).toContain("import('./pdf417Decoder.js')");
  });
});
