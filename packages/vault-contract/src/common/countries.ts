// =============================================================================
// Country codes: ISO 3166-1 plus the ICAO 9303 extras
// =============================================================================
//
// Pure data and pure helpers (no Node import), shared by the API's document
// checks and the web app's country fields.

/**
 * One row of {@link COUNTRY_TABLE}.
 *
 * `alpha2` is `null` for the ICAO 9303 codes that have no ISO 3166-1 entry
 * (`GBD`, `UNO`, `XXA`, the `UTO` specimen state, ...).
 *
 * @stability experimental
 */
export interface CountryEntry {
  alpha3: string;
  alpha2: string | null;
  name: string;
}

type Row = readonly [alpha3: string, alpha2: string | null, name: string];

const ISO_3166_1: readonly Row[] = [
  ['AFG', 'AF', 'Afghanistan'],
  ['ALA', 'AX', 'Aland Islands'],
  ['ALB', 'AL', 'Albania'],
  ['DZA', 'DZ', 'Algeria'],
  ['ASM', 'AS', 'American Samoa'],
  ['AND', 'AD', 'Andorra'],
  ['AGO', 'AO', 'Angola'],
  ['AIA', 'AI', 'Anguilla'],
  ['ATA', 'AQ', 'Antarctica'],
  ['ATG', 'AG', 'Antigua and Barbuda'],
  ['ARG', 'AR', 'Argentina'],
  ['ARM', 'AM', 'Armenia'],
  ['ABW', 'AW', 'Aruba'],
  ['AUS', 'AU', 'Australia'],
  ['AUT', 'AT', 'Austria'],
  ['AZE', 'AZ', 'Azerbaijan'],
  ['BHS', 'BS', 'Bahamas'],
  ['BHR', 'BH', 'Bahrain'],
  ['BGD', 'BD', 'Bangladesh'],
  ['BRB', 'BB', 'Barbados'],
  ['BLR', 'BY', 'Belarus'],
  ['BEL', 'BE', 'Belgium'],
  ['BLZ', 'BZ', 'Belize'],
  ['BEN', 'BJ', 'Benin'],
  ['BMU', 'BM', 'Bermuda'],
  ['BTN', 'BT', 'Bhutan'],
  ['BOL', 'BO', 'Bolivia'],
  ['BES', 'BQ', 'Bonaire, Sint Eustatius and Saba'],
  ['BIH', 'BA', 'Bosnia and Herzegovina'],
  ['BWA', 'BW', 'Botswana'],
  ['BVT', 'BV', 'Bouvet Island'],
  ['BRA', 'BR', 'Brazil'],
  ['IOT', 'IO', 'British Indian Ocean Territory'],
  ['BRN', 'BN', 'Brunei Darussalam'],
  ['BGR', 'BG', 'Bulgaria'],
  ['BFA', 'BF', 'Burkina Faso'],
  ['BDI', 'BI', 'Burundi'],
  ['CPV', 'CV', 'Cabo Verde'],
  ['KHM', 'KH', 'Cambodia'],
  ['CMR', 'CM', 'Cameroon'],
  ['CAN', 'CA', 'Canada'],
  ['CYM', 'KY', 'Cayman Islands'],
  ['CAF', 'CF', 'Central African Republic'],
  ['TCD', 'TD', 'Chad'],
  ['CHL', 'CL', 'Chile'],
  ['CHN', 'CN', 'China'],
  ['CXR', 'CX', 'Christmas Island'],
  ['CCK', 'CC', 'Cocos (Keeling) Islands'],
  ['COL', 'CO', 'Colombia'],
  ['COM', 'KM', 'Comoros'],
  ['COG', 'CG', 'Congo'],
  ['COD', 'CD', 'Congo, Democratic Republic of the'],
  ['COK', 'CK', 'Cook Islands'],
  ['CRI', 'CR', 'Costa Rica'],
  ['CIV', 'CI', "Cote d'Ivoire"],
  ['HRV', 'HR', 'Croatia'],
  ['CUB', 'CU', 'Cuba'],
  ['CUW', 'CW', 'Curacao'],
  ['CYP', 'CY', 'Cyprus'],
  ['CZE', 'CZ', 'Czechia'],
  ['DNK', 'DK', 'Denmark'],
  ['DJI', 'DJ', 'Djibouti'],
  ['DMA', 'DM', 'Dominica'],
  ['DOM', 'DO', 'Dominican Republic'],
  ['ECU', 'EC', 'Ecuador'],
  ['EGY', 'EG', 'Egypt'],
  ['SLV', 'SV', 'El Salvador'],
  ['GNQ', 'GQ', 'Equatorial Guinea'],
  ['ERI', 'ER', 'Eritrea'],
  ['EST', 'EE', 'Estonia'],
  ['SWZ', 'SZ', 'Eswatini'],
  ['ETH', 'ET', 'Ethiopia'],
  ['FLK', 'FK', 'Falkland Islands (Malvinas)'],
  ['FRO', 'FO', 'Faroe Islands'],
  ['FJI', 'FJ', 'Fiji'],
  ['FIN', 'FI', 'Finland'],
  ['FRA', 'FR', 'France'],
  ['GUF', 'GF', 'French Guiana'],
  ['PYF', 'PF', 'French Polynesia'],
  ['ATF', 'TF', 'French Southern Territories'],
  ['GAB', 'GA', 'Gabon'],
  ['GMB', 'GM', 'Gambia'],
  ['GEO', 'GE', 'Georgia'],
  ['DEU', 'DE', 'Germany'],
  ['GHA', 'GH', 'Ghana'],
  ['GIB', 'GI', 'Gibraltar'],
  ['GRC', 'GR', 'Greece'],
  ['GRL', 'GL', 'Greenland'],
  ['GRD', 'GD', 'Grenada'],
  ['GLP', 'GP', 'Guadeloupe'],
  ['GUM', 'GU', 'Guam'],
  ['GTM', 'GT', 'Guatemala'],
  ['GGY', 'GG', 'Guernsey'],
  ['GIN', 'GN', 'Guinea'],
  ['GNB', 'GW', 'Guinea-Bissau'],
  ['GUY', 'GY', 'Guyana'],
  ['HTI', 'HT', 'Haiti'],
  ['HMD', 'HM', 'Heard Island and McDonald Islands'],
  ['VAT', 'VA', 'Holy See'],
  ['HND', 'HN', 'Honduras'],
  ['HKG', 'HK', 'Hong Kong'],
  ['HUN', 'HU', 'Hungary'],
  ['ISL', 'IS', 'Iceland'],
  ['IND', 'IN', 'India'],
  ['IDN', 'ID', 'Indonesia'],
  ['IRN', 'IR', 'Iran'],
  ['IRQ', 'IQ', 'Iraq'],
  ['IRL', 'IE', 'Ireland'],
  ['IMN', 'IM', 'Isle of Man'],
  ['ISR', 'IL', 'Israel'],
  ['ITA', 'IT', 'Italy'],
  ['JAM', 'JM', 'Jamaica'],
  ['JPN', 'JP', 'Japan'],
  ['JEY', 'JE', 'Jersey'],
  ['JOR', 'JO', 'Jordan'],
  ['KAZ', 'KZ', 'Kazakhstan'],
  ['KEN', 'KE', 'Kenya'],
  ['KIR', 'KI', 'Kiribati'],
  ['PRK', 'KP', 'North Korea'],
  ['KOR', 'KR', 'South Korea'],
  ['KWT', 'KW', 'Kuwait'],
  ['KGZ', 'KG', 'Kyrgyzstan'],
  ['LAO', 'LA', 'Laos'],
  ['LVA', 'LV', 'Latvia'],
  ['LBN', 'LB', 'Lebanon'],
  ['LSO', 'LS', 'Lesotho'],
  ['LBR', 'LR', 'Liberia'],
  ['LBY', 'LY', 'Libya'],
  ['LIE', 'LI', 'Liechtenstein'],
  ['LTU', 'LT', 'Lithuania'],
  ['LUX', 'LU', 'Luxembourg'],
  ['MAC', 'MO', 'Macao'],
  ['MDG', 'MG', 'Madagascar'],
  ['MWI', 'MW', 'Malawi'],
  ['MYS', 'MY', 'Malaysia'],
  ['MDV', 'MV', 'Maldives'],
  ['MLI', 'ML', 'Mali'],
  ['MLT', 'MT', 'Malta'],
  ['MHL', 'MH', 'Marshall Islands'],
  ['MTQ', 'MQ', 'Martinique'],
  ['MRT', 'MR', 'Mauritania'],
  ['MUS', 'MU', 'Mauritius'],
  ['MYT', 'YT', 'Mayotte'],
  ['MEX', 'MX', 'Mexico'],
  ['FSM', 'FM', 'Micronesia'],
  ['MDA', 'MD', 'Moldova'],
  ['MCO', 'MC', 'Monaco'],
  ['MNG', 'MN', 'Mongolia'],
  ['MNE', 'ME', 'Montenegro'],
  ['MSR', 'MS', 'Montserrat'],
  ['MAR', 'MA', 'Morocco'],
  ['MOZ', 'MZ', 'Mozambique'],
  ['MMR', 'MM', 'Myanmar'],
  ['NAM', 'NA', 'Namibia'],
  ['NRU', 'NR', 'Nauru'],
  ['NPL', 'NP', 'Nepal'],
  ['NLD', 'NL', 'Netherlands'],
  ['NCL', 'NC', 'New Caledonia'],
  ['NZL', 'NZ', 'New Zealand'],
  ['NIC', 'NI', 'Nicaragua'],
  ['NER', 'NE', 'Niger'],
  ['NGA', 'NG', 'Nigeria'],
  ['NIU', 'NU', 'Niue'],
  ['NFK', 'NF', 'Norfolk Island'],
  ['MKD', 'MK', 'North Macedonia'],
  ['MNP', 'MP', 'Northern Mariana Islands'],
  ['NOR', 'NO', 'Norway'],
  ['OMN', 'OM', 'Oman'],
  ['PAK', 'PK', 'Pakistan'],
  ['PLW', 'PW', 'Palau'],
  ['PSE', 'PS', 'Palestine, State of'],
  ['PAN', 'PA', 'Panama'],
  ['PNG', 'PG', 'Papua New Guinea'],
  ['PRY', 'PY', 'Paraguay'],
  ['PER', 'PE', 'Peru'],
  ['PHL', 'PH', 'Philippines'],
  ['PCN', 'PN', 'Pitcairn'],
  ['POL', 'PL', 'Poland'],
  ['PRT', 'PT', 'Portugal'],
  ['PRI', 'PR', 'Puerto Rico'],
  ['QAT', 'QA', 'Qatar'],
  ['REU', 'RE', 'Reunion'],
  ['ROU', 'RO', 'Romania'],
  ['RUS', 'RU', 'Russia'],
  ['RWA', 'RW', 'Rwanda'],
  ['BLM', 'BL', 'Saint Barthelemy'],
  ['SHN', 'SH', 'Saint Helena, Ascension and Tristan da Cunha'],
  ['KNA', 'KN', 'Saint Kitts and Nevis'],
  ['LCA', 'LC', 'Saint Lucia'],
  ['MAF', 'MF', 'Saint Martin (French part)'],
  ['SPM', 'PM', 'Saint Pierre and Miquelon'],
  ['VCT', 'VC', 'Saint Vincent and the Grenadines'],
  ['WSM', 'WS', 'Samoa'],
  ['SMR', 'SM', 'San Marino'],
  ['STP', 'ST', 'Sao Tome and Principe'],
  ['SAU', 'SA', 'Saudi Arabia'],
  ['SEN', 'SN', 'Senegal'],
  ['SRB', 'RS', 'Serbia'],
  ['SYC', 'SC', 'Seychelles'],
  ['SLE', 'SL', 'Sierra Leone'],
  ['SGP', 'SG', 'Singapore'],
  ['SXM', 'SX', 'Sint Maarten (Dutch part)'],
  ['SVK', 'SK', 'Slovakia'],
  ['SVN', 'SI', 'Slovenia'],
  ['SLB', 'SB', 'Solomon Islands'],
  ['SOM', 'SO', 'Somalia'],
  ['ZAF', 'ZA', 'South Africa'],
  ['SGS', 'GS', 'South Georgia and the South Sandwich Islands'],
  ['SSD', 'SS', 'South Sudan'],
  ['ESP', 'ES', 'Spain'],
  ['LKA', 'LK', 'Sri Lanka'],
  ['SDN', 'SD', 'Sudan'],
  ['SUR', 'SR', 'Suriname'],
  ['SJM', 'SJ', 'Svalbard and Jan Mayen'],
  ['SWE', 'SE', 'Sweden'],
  ['CHE', 'CH', 'Switzerland'],
  ['SYR', 'SY', 'Syria'],
  ['TWN', 'TW', 'Taiwan'],
  ['TJK', 'TJ', 'Tajikistan'],
  ['TZA', 'TZ', 'Tanzania'],
  ['THA', 'TH', 'Thailand'],
  ['TLS', 'TL', 'Timor-Leste'],
  ['TGO', 'TG', 'Togo'],
  ['TKL', 'TK', 'Tokelau'],
  ['TON', 'TO', 'Tonga'],
  ['TTO', 'TT', 'Trinidad and Tobago'],
  ['TUN', 'TN', 'Tunisia'],
  ['TUR', 'TR', 'Turkiye'],
  ['TKM', 'TM', 'Turkmenistan'],
  ['TCA', 'TC', 'Turks and Caicos Islands'],
  ['TUV', 'TV', 'Tuvalu'],
  ['UGA', 'UG', 'Uganda'],
  ['UKR', 'UA', 'Ukraine'],
  ['ARE', 'AE', 'United Arab Emirates'],
  ['GBR', 'GB', 'United Kingdom'],
  ['USA', 'US', 'United States'],
  ['UMI', 'UM', 'United States Minor Outlying Islands'],
  ['URY', 'UY', 'Uruguay'],
  ['UZB', 'UZ', 'Uzbekistan'],
  ['VUT', 'VU', 'Vanuatu'],
  ['VEN', 'VE', 'Venezuela'],
  ['VNM', 'VN', 'Viet Nam'],
  ['VGB', 'VG', 'Virgin Islands (British)'],
  ['VIR', 'VI', 'Virgin Islands (U.S.)'],
  ['WLF', 'WF', 'Wallis and Futuna'],
  ['ESH', 'EH', 'Western Sahara'],
  ['YEM', 'YE', 'Yemen'],
  ['ZMB', 'ZM', 'Zambia'],
  ['ZWE', 'ZW', 'Zimbabwe'],
];

/** ICAO 9303 codes with no ISO 3166-1 alpha-3 entry (Part 3, Doc 9303). */
const ICAO_EXTRAS: readonly Row[] = [
  ['GBD', null, 'British Overseas Territories Citizen'],
  ['GBN', null, 'British National (Overseas)'],
  ['GBO', null, 'British Overseas Citizen'],
  ['GBP', null, 'British Protected Person'],
  ['GBS', null, 'British Subject'],
  ['UNO', null, 'United Nations Organization (official)'],
  ['UNA', null, 'United Nations specialized agency (official)'],
  ['UNK', null, 'Kosovo (UN interim administration)'],
  ['XXA', null, 'Stateless person'],
  ['XXB', null, 'Refugee (1951 Convention)'],
  ['XXC', null, 'Refugee (other)'],
  ['XXX', null, 'Unspecified nationality'],
  ['UTO', null, 'Utopia (ICAO specimen state)'],
];

/**
 * Every country code Vault knows: the ISO 3166-1 table followed by the ICAO
 * 9303 extras (`GBD`, `GBN`, `GBO`, `GBP`, `GBS`, `UNO`, `UNA`, `UNK`, `XXA`,
 * `XXB`, `XXC`, `XXX`) and the specimen state `UTO`.
 *
 * The one-letter MRZ code `D` (Germany) is not a row: {@link toAlpha3} maps it
 * to `DEU`.
 *
 * @stability experimental
 */
export const COUNTRY_TABLE: readonly CountryEntry[] = Object.freeze(
  [...ISO_3166_1, ...ICAO_EXTRAS].map(([alpha3, alpha2, name]) =>
    Object.freeze({ alpha3, alpha2, name })
  )
);

/**
 * The alpha-3 code of every {@link COUNTRY_TABLE} row, in table order.
 *
 * @stability experimental
 */
export const COUNTRY_CODES: readonly string[] = Object.freeze(COUNTRY_TABLE.map((c) => c.alpha3));

const ALPHA3 = new Set(COUNTRY_CODES);
const BY_ALPHA2 = new Map<string, string>();
const BY_NAME = new Map<string, string>();
for (const c of COUNTRY_TABLE) {
  if (c.alpha2 !== null) BY_ALPHA2.set(c.alpha2, c.alpha3);
  BY_NAME.set(nameKey(c.name), c.alpha3);
}
/** Common English names that differ from the table's. */
const NAME_ALIASES: Readonly<Record<string, string>> = {
  'united states of america': 'USA',
  america: 'USA',
  'great britain': 'GBR',
  britain: 'GBR',
  england: 'GBR',
  'korea, republic of': 'KOR',
  'republic of korea': 'KOR',
  "korea, democratic people's republic of": 'PRK',
  'russian federation': 'RUS',
  turkey: 'TUR',
  'czech republic': 'CZE',
  vietnam: 'VNM',
  'ivory coast': 'CIV',
  'cape verde': 'CPV',
  swaziland: 'SWZ',
  macedonia: 'MKD',
  burma: 'MMR',
  holland: 'NLD',
  'vatican city': 'VAT',
  'democratic republic of the congo': 'COD',
  'republic of the congo': 'COG',
  palestine: 'PSE',
  kosovo: 'UNK',
};
for (const [alias, code] of Object.entries(NAME_ALIASES)) BY_NAME.set(alias, code);

function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * `true` when `code` is an alpha-3 code of {@link COUNTRY_TABLE} (ISO 3166-1 or
 * an ICAO extra such as `UTO`). Upper case only: `'deu'` is `false`.
 *
 * @stability experimental
 */
export function isCountryCode(code: string): boolean {
  return ALPHA3.has(code);
}

/**
 * Resolves an alpha-2 code, an alpha-3 code or an English name
 * (case-insensitive, surrounding spaces ignored) to the alpha-3 code. Trailing
 * MRZ fillers are dropped, and the MRZ code `D` maps to `DEU`. `null` when
 * nothing matches.
 *
 * @stability experimental
 */
export function toAlpha3(input: string): string | null {
  const raw = input.trim().replace(/<+$/, '');
  const upper = raw.toUpperCase();
  if (upper === 'D') return 'DEU';
  if (upper.length === 3 && ALPHA3.has(upper)) return upper;
  if (upper.length === 2) return BY_ALPHA2.get(upper) ?? null;
  return BY_NAME.get(nameKey(raw)) ?? null;
}
