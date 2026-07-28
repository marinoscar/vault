/**
 * AI Providers Barrel Export
 */

export {
  AI_VISION_PROVIDER,
  AiProviderError,
  EXTRACTED_FIELD_NAMES,
} from './vision-provider.interface';
export type {
  AiProviderErrorDetail,
  AiProviderErrorKind,
  AiVisionProvider,
  CardCropBox,
  CardSide,
  ExtractCardOptions,
  ExtractedFieldName,
  RawCardConfidence,
  RawCardFields,
  RawExtraction,
  VerifyModelResult,
  VisionImage,
} from './vision-provider.interface';
export { OpenAiVisionProvider } from './openai/openai-vision.provider';
export {
  OPENAI_CARD_JSON_SCHEMA,
  OPENAI_CARD_SCHEMA_NAME,
  OPENAI_CARD_SYSTEM_PROMPT,
  openAiCardResponseSchema,
} from './openai/openai-card-schema';
export {
  ADAPTIVE_DROPPABLE_PARAMS,
  classifyUpstreamError,
  detectUnsupportedParameter,
  parseErrorEnvelope,
  requestIncludesImage,
} from './openai/openai-error-classifier';
export type {
  OpenAiErrorEnvelope,
  OpenAiUpstreamReason,
} from './openai/openai-error-classifier';
export {
  OPENAI_CHAT_COMPLETIONS_URL,
  sendChatCompletion,
} from './openai/openai-chat.client';
export {
  ONE_PIXEL_PNG_DATA_URL,
  OPENAI_PROBE_JSON_SCHEMA,
  OPENAI_PROBE_SCHEMA_NAME,
  buildProbeRequestBody,
} from './openai/openai-probe';
