import {
  AiVisionProvider,
  EXTRACTED_FIELD_NAMES,
  RawCardConfidence,
  RawCardFields,
  RawExtraction,
  VerifyModelResult,
} from '../../src/ai/providers';

/**
 * Build a RawExtraction with every field null and every confidence 0, then
 * apply overrides. Mirrors the storage-provider mock idiom: sensible defaults
 * that individual tests narrow.
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

/**
 * Default result of a successful capability probe.
 *
 * `droppedParameters` is empty, i.e. "the model took our request as sent".
 * Tests covering the adaptive-parameter path override it.
 */
export function buildVerifyModelResult(
  overrides: Partial<VerifyModelResult> = {},
): VerifyModelResult {
  return {
    model: 'gpt-4o-mini-2024-07-18',
    droppedParameters: [],
    ...overrides,
  };
}

/**
 * Mock vision provider.
 *
 * Every test binds this at the AI_VISION_PROVIDER token so that no test can
 * reach api.openai.com. The provider's own spec is the only place `fetch` is
 * exercised, and it stubs `global.fetch`.
 */
export const createMockAiVisionProvider = (): jest.Mocked<AiVisionProvider> => ({
  extractCard: jest.fn().mockResolvedValue(buildRawExtraction()),
  verifyModel: jest.fn().mockResolvedValue(buildVerifyModelResult()),
});
