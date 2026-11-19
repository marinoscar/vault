---
'@marinoscar/vault-contract': minor
'@marinoscar/vault-api': minor
---

Add the document check library for AI document scanning (IDOC-2, #205). `@marinoscar/vault-contract/common` gains the country table: `COUNTRY_TABLE` (ISO 3166-1 plus the ICAO 9303 codes `GBD`, `GBN`, `GBO`, `GBP`, `GBS`, `UNO`, `UNA`, `UNK`, `XXA`, `XXB`, `XXC`, `XXX` and the `UTO` specimen state), `COUNTRY_CODES`, `isCountryCode` and `toAlpha3` (alpha-2, alpha-3 or English name; the MRZ `D` maps to `DEU`). `@marinoscar/vault-api/ai` gains pure checks: `parseMrz` and `mrzCheckDigit` (TD1, TD2, TD3 with OCR repair of numeric positions), `checkSsn`, `checkVin` and `vinCheckDigit`, `normalizeDate` and `mrzDate`, `isMrzCountryCode` and the `CheckId` union. All `@stability experimental`.
