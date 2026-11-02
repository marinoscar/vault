// =============================================================================
// Vault's AI features (issue #87, E8.1)
// =============================================================================
//
// Every place Vault calls a model is a registered AI feature: the platform stamps
// the feature id on the usage row (so `GET /api/admin/ai/usage` groups by it),
// checks `needs` against the chosen model's capabilities and lists it at
// `GET /api/ai/features`.
//
//   id             call site                                  needs
//   card_extract   POST /api/secrets/cards/extract            responses + image input
//
// ⚠ A FEATURE ID IS PERMANENT: usage rows carry it. It is lower snake case (the
// platform's `AI_FEATURE_ID_PATTERN` refuses a hyphen or a dot), which is why it
// is `card_extract` and not the `card-extract` of the issue text.
//
// Imported once, from `platform/ai/ai.config.ts`, at module load: the registry
// freezes when the application bootstraps.
// =============================================================================

import { registerAiFeature } from '@marinoscar/platform-api/ai';

registerAiFeature({
  id: 'card_extract',
  label: 'Card scanning',
  group: 'vault',
  needs: ['responses', 'structured_output', 'vision_input'],
});
