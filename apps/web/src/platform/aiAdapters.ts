/**
 * What the packaged AI pages take from Vault (E8.2, issue #88).
 *
 * `@marinoscar/platform-web/ai/ui` renders the Console's AI, AI models and AI
 * usage pages. They are the platform's; Vault hands in only its spinner, once,
 * as a module constant (a new object every render would re-render every page).
 *
 * Mounted by `App.tsx` through `AiWebAdaptersProvider`, inside the platform host.
 */

import type { AiWebAdapters } from '@marinoscar/platform-web/ai/headless';
import { LoadingSpinner } from '../components/common/LoadingSpinner';

export const vaultAiAdapters: AiWebAdapters = {
  Spinner: LoadingSpinner,
};
