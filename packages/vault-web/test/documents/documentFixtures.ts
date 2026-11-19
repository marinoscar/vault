// Invented fixtures for the document scan tests (#211): the system Passport and
// ID Document types from the contract, and extraction results with made-up
// values (Person A, the ICAO specimen state UTO). No real document.
import { SYSTEM_SECRET_TYPES } from '@marinoscar/vault-contract/secret-types';
import type { ExtractDocumentResponse } from '@marinoscar/vault-contract/secrets';

import type { SecretType } from '../../src/core/headless/types.js';

function systemType(name: string, id: string): SecretType {
  const def = SYSTEM_SECRET_TYPES.find((t) => t.name === name);
  if (!def) throw new Error(`missing system type ${name}`);
  return {
    id,
    name: def.name,
    description: def.description,
    icon: def.icon,
    isSystem: true,
    allowAttachments: def.allowAttachments,
    createdAt: '2026-01-01T00:00:00Z',
    fields: def.fields,
  } as SecretType;
}

export const PASSPORT_TYPE = systemType('Passport', 'type-passport');
export const ID_DOCUMENT_TYPE = systemType('ID Document', 'type-id-document');

export const ID_EXTRACTION: ExtractDocumentResponse = {
  documentType: 'id_document',
  fields: {
    holder_name: 'PERSON A EXAMPLE',
    document_number: 'D1234567',
    issuing_country: 'UTO',
    issuing_authority: 'Specimen State',
    date_of_birth: '1980-01-01',
    issue_date: '2020-02-02',
    expiry_date: '2030-02-02',
    notes: null,
  },
  confidence: {
    holder_name: 0.95,
    document_number: 0.5,
    issuing_country: 0.9,
    issuing_authority: 0.9,
    date_of_birth: 0.9,
    issue_date: 0.9,
    expiry_date: 0.9,
  },
  documentKind: { value: 'Driver License', confidence: 0.92 },
  attributes: [
    { key: 'license_class', label: 'Class', value: 'C', sensitive: false, confidence: 0.95 },
    { key: 'restrictions', label: 'Restrictions', value: 'NONE', sensitive: false, confidence: 0.4 },
  ],
  checks: [],
  warnings: ['The back photo was blurry.'],
  crops: { front: null, back: null },
  model: 'model-x',
  partial: false,
};

export const PASSPORT_EXTRACTION: ExtractDocumentResponse = {
  documentType: 'passport',
  fields: {
    surname: 'EXAMPLE',
    given_names: 'PERSON A',
    passport_number: 'X0000000',
    issuing_country: 'UTO',
    nationality: 'UTO',
    sex: 'X',
    expiry_date: '2031-03-03',
  },
  confidence: { surname: 0.95, given_names: 0.95, passport_number: 0.9, issuing_country: 0.95, expiry_date: 0.6 },
  documentKind: null,
  attributes: [],
  checks: [{ id: 'mrz', ok: false, failed: ['passport_number'] }],
  warnings: [],
  crops: { data_page: null },
  model: 'model-x',
  partial: false,
};
