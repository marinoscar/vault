// =============================================================================
// Scan profiles (issue #204, IDOC-1)
// =============================================================================
// A scan profile is everything document-specific about an AI scan: the prompt,
// the model-facing schema, the image slots, the repair and the normalizer.
// `DocumentScanService` runs the generic part (the platform call, the timeout,
// the error taxonomy, the metric) for any registered profile.

import type { z } from 'zod';

import type { CARD_EXTRACTION_OUTCOMES } from '../../core/metric-labels';
import type { VaultMetricsPort } from '../../ports';

/**
 * One image a profile accepts. Slots are ordered: the order is the order of
 * the image parts sent to the model.
 *
 * @stability experimental
 */
export interface ScanImageSlot {
  /** The key in the images record (`front`, `back`, ...). */
  key: string;
  /** A required slot that is missing fails the scan with `AI_INVALID_IMAGE`. */
  required: boolean;
  /** Human-readable name of the slot. */
  label: string;
}

/** The outcome label of one scan (the metric label set). @stability experimental */
export type ScanOutcome = (typeof CARD_EXTRACTION_OUTCOMES)[number];

/**
 * A registered kind of document scan.
 *
 * @typeParam TModel - the structured answer the model returns (validated by `modelSchema`)
 * @typeParam TResult - what the scan returns to the caller
 * @stability experimental
 */
export interface ScanProfile<TModel = unknown, TResult = unknown> {
  /** Registry key; permanent once shipped. */
  id: 'card' | (string & {});
  /** The registered platform AI feature id the call runs under (e.g. `card_extract`). */
  aiFeature: string;
  /** Ordered image slots; drive the image parts of the request. */
  imageSlots: readonly ScanImageSlot[];
  /** The structured-output schema name sent to the provider. */
  schemaName: string;
  /** The system instructions. */
  systemPrompt: string;
  /** The model-facing schema. */
  modelSchema: z.ZodType<TModel>;
  /** The text line sent with the images, given the images that were provided. */
  userText(images: Readonly<Record<string, string>>): string;
  /** Trim and repair the validated answer; `ctx.model` is the model that answered. */
  toRaw(model: TModel, ctx: { model: string }): unknown;
  /** The caller-facing result; `providedSlots` lists the slots actually sent, in slot order. */
  normalize(raw: unknown, ctx: { providedSlots: string[]; model: string }): TResult;
  /** Backstop for a wedged provider connection, in milliseconds. */
  timeoutMs: number;
  /** Records one outcome on the metrics port (labels only: never a value, an image or a user). */
  recordOutcome?(metrics: VaultMetricsPort, outcome: ScanOutcome): void;
}
