// =============================================================================
// The telemetry assistant's AI port: a stand-in until the AI slice (issue #90)
// =============================================================================
//
// PLATFORM-ADOPTION-SHIM(E8): the telemetry assistant spends the calling user's
// own AI key through the platform AI slice (`AiService.forUser`). Vault mounts that
// slice in E8; until it lands Vault has no `AiService`, so this
// port answers "AI is not configured" to every assistant request. The guard
// (`TelemetryAiEnabledGuard`) calls `assertEnabled()` first, so the assistant
// route answers 503 `AI_NOT_CONFIGURED` (a code Vault registers) before anything
// runs; nothing is sent to a provider and no key is touched.
//
// E8 replaces this class with the binding over `AiService` / `AiConfigService`
// (see EnterpriseAppBase `apps/api/src/platform/telemetry/telemetry-ai.adapter.ts`)
// and deletes this file's marker. The explorer, the dashboard and everything else
// in the slice work without it.
// =============================================================================

import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type {
  TelemetryAiError,
  TelemetryAiPort,
  TelemetryAiSession,
  TelemetryAiTool,
  TelemetryAiToolDefinition,
} from '@marinoscar/platform-api/telemetry';
import type { z } from 'zod';

const NOT_CONFIGURED = {
  code: 'AI_NOT_CONFIGURED',
  message: 'The telemetry assistant needs the AI platform, which is not enabled in this deployment yet.',
} as const;

@Injectable()
export class TelemetryAiAdapter implements TelemetryAiPort {
  forUser(_userId: string): TelemetryAiSession {
    return {
      runTools: () => Promise.reject(new ServiceUnavailableException(NOT_CONFIGURED)),
    };
  }

  defineTool<P extends z.ZodType, R>(definition: TelemetryAiToolDefinition<P, R>): TelemetryAiTool {
    // Opaque to telemetry; never executed while the stand-in refuses every run.
    return definition as unknown as TelemetryAiTool;
  }

  isAiError(_error: unknown): _error is TelemetryAiError {
    return false;
  }

  /** Throws the 503 `AI_NOT_CONFIGURED` until the AI slice is mounted. */
  assertEnabled(): Promise<void> {
    return Promise.reject(new ServiceUnavailableException(NOT_CONFIGURED));
  }
}
