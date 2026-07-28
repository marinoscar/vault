// =============================================================================
// AI Verify Result
// =============================================================================

/**
 * Why a verification failed.
 *
 * `unknown` is a first-class outcome, not a bug. When the upstream error shape
 * is unfamiliar we say so, because telling an administrator "your model does not
 * support images" on a guess sends them to change the wrong setting, and the
 * next model family will have error shapes nobody has seen yet.
 */
export type AiVerifyFailureReason =
  /** The stored credential was rejected. */
  | 'invalid_key'
  /** The model name does not resolve for this credential. */
  | 'model_not_found'
  /** The model exists but refused image content. */
  | 'model_no_image_support'
  /** The model exists but refused `response_format: json_schema`. */
  | 'model_no_structured_output'
  /** Out of credit, or throttled hard enough that the check could not run. */
  | 'quota'
  /** DNS, connection reset, or the probe timed out. */
  | 'network'
  /** Reached the provider, got a failure we will not guess the cause of. */
  | 'unknown';

export interface AiVerifySuccess {
  ok: true;
  /** Model as reported by the provider (often a dated snapshot id). */
  model: string;
  /**
   * Always `true` on success, and only ever produced by a real request that
   * carried an image. There is no path that reports image support without
   * having proven it.
   */
  imageSupport: true;
  /** Wall-clock duration of the probe, including any adaptive retry. */
  durationMs: number;
  /**
   * Parameters the API had to drop for this model to accept the request.
   * Empty for a model that took the request as sent. Surfaced so an admin can
   * see that e.g. `temperature` is being ignored for their chosen model.
   */
  adaptedParameters: string[];
}

export interface AiVerifyFailure {
  ok: false;
  reason: AiVerifyFailureReason;
  /**
   * Operator-facing explanation. Written here, never taken from the upstream
   * body: OpenAI reflects request fragments back in its errors.
   */
  message: string;
  /** The model that was tested, echoed so the admin can see what was checked. */
  model: string;
  durationMs: number;
  adaptedParameters: string[];
}

export type AiVerifyResult = AiVerifySuccess | AiVerifyFailure;

/**
 * Fixed, operator-facing copy for each failure reason.
 *
 * Held here rather than built from the upstream message so that no part of an
 * OpenAI error body - which can contain reflected request content - can reach a
 * client, and so the wording stays actionable rather than provider jargon.
 */
export const AI_VERIFY_FAILURE_MESSAGES: Record<AiVerifyFailureReason, string> =
  {
    invalid_key:
      'The provider rejected the stored API key. Re-enter it in System Settings and check that it has not been revoked.',
    model_not_found:
      'The provider does not recognise this model name, or this API key does not have access to it. Check the model setting for a typo, and check that your account has been granted access to it.',
    model_no_image_support:
      'This model exists and the key works, but the model will not accept image input. Card scanning needs a vision-capable model - choose a different one.',
    model_no_structured_output:
      'This model exists and the key works, but it will not accept the strict JSON schema card scanning requires. Choose a model that supports structured outputs.',
    quota: 'The provider refused the request for quota or billing reasons, or is rate limiting this key. Check the account balance and limits, then try again.',
    network:
      'Could not reach the provider - the request timed out or the connection failed. Check outbound network access from the API container, then try again.',
    unknown:
      'The provider rejected the check for a reason this application does not recognise. The full upstream response has been written to the API debug log.',
  };
