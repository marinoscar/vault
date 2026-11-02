import {
  EXTRACTED_FIELD_NAMES,
  RawCardConfidence,
  RawCardFields,
  RawExtraction,
} from '../../src/ai/card-extraction.types';

/**
 * Build a RawExtraction with every field null and every confidence 0, then
 * apply overrides. Sensible defaults that individual tests narrow.
 */
export function buildRawExtraction(
  fields: Partial<RawCardFields> = {},
  confidence: Partial<RawCardConfidence> = {},
  overrides: Partial<
    Pick<RawExtraction, 'warnings' | 'model' | 'frontBox' | 'backBox'>
  > = {},
): RawExtraction {
  const baseFields = {} as RawCardFields;
  const baseConfidence = {} as RawCardConfidence;

  for (const name of EXTRACTED_FIELD_NAMES) {
    baseFields[name] = null;
    baseConfidence[name] = 0;
  }

  return {
    fields: { ...baseFields, ...fields },
    confidence: { ...baseConfidence, ...confidence },
    warnings: overrides.warnings ?? [],
    model: overrides.model ?? 'gpt-4o-mini',
    frontBox: overrides.frontBox ?? null,
    backBox: overrides.backBox ?? null,
  };
}
