/**
 * What the packaged telemetry pages take from this app (issue #90, E9.2).
 *
 * `@marinoscar/platform-web/telemetry/ui` renders the Telemetry settings page, the
 * Explorer and the Dashboard. The pages are the platform's; what is this app's is
 * handed in here, once, as a module constant:
 *
 *   - `Spinner`: this app's `LoadingSpinner`.
 *   - `useAiEnabled` / `useAssistantModels`: the telemetry assistant's two app
 *     hooks. PLATFORM-ADOPTION-SHIM(E8): Vault has no platform AI slice yet, so AI
 *     reads as OFF and there are no models: the assistant is hidden (the API's
 *     assistant route answers 503 `AI_NOT_CONFIGURED` too). E8 replaces both with
 *     the platform AI hooks (`useAiConfig`, `useAiModels` from
 *     `@marinoscar/platform-web/ai/headless`) and deletes the marker.
 *
 * The hooks are called by the package on every render of its pages, so they are
 * module-level functions, never recreated.
 */

import type {
  TelemetryAiEnabledState,
  TelemetryAssistantModelsState,
  TelemetryWebAdapters,
} from '@marinoscar/platform-web/telemetry/headless';
import { LoadingSpinner } from '../components/common/LoadingSpinner';

const AI_OFF: TelemetryAiEnabledState = { enabled: false, isLoading: false };
const NO_MODELS: TelemetryAssistantModelsState = { models: [], isLoading: false, error: null };

function useAiEnabled(): TelemetryAiEnabledState {
  return AI_OFF;
}

function useAssistantModels(): TelemetryAssistantModelsState {
  return NO_MODELS;
}

export const appTelemetryAdapters: TelemetryWebAdapters = {
  useAiEnabled,
  useAssistantModels,
  Spinner: LoadingSpinner,
};
