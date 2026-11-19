// =============================================================================
// AAMVA barcode cross-check helpers (issue #214, IDOC-11; pure, no I/O)
// =============================================================================
// The browser decodes the PDF417 barcode on the back of a US or Canadian
// driver license and sends the parsed values; the document normalizer compares
// them with what the model read. These helpers decide when two values agree.

/**
 * The jurisdictions an AAMVA barcode names in `DAJ`: the US states, the
 * District of Columbia, the US territories and the Canadian provinces and
 * territories, by their two-letter code.
 *
 * @stability experimental
 */
export const AAMVA_JURISDICTIONS: Readonly<Record<string, string>> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  AS: 'American Samoa',
  GU: 'Guam',
  MP: 'Northern Mariana Islands',
  PR: 'Puerto Rico',
  VI: 'Virgin Islands',
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon',
};

const words = (s: string): string[] =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

/**
 * Whether a printed issuing authority names the jurisdiction `code` of the
 * barcode: the code itself as a word (`ZZ`, `ZZ DMV`) or, for a known code, its
 * full name (`State of Ohio`, `Québec`).
 *
 * @stability experimental
 */
export function jurisdictionAgrees(printed: string, code: string): boolean {
  const target = code.trim().toUpperCase();
  if (target === '') return true;
  const printedWords = words(printed);
  if (printedWords.includes(target)) return true;
  const name = AAMVA_JURISDICTIONS[target];
  if (!name) return false;
  return ` ${printedWords.join(' ')} `.includes(` ${words(name).join(' ')} `);
}
