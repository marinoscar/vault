import AiConfigPage from '@marinoscar/platform-web/ai/ui/config-page';
import type { AiConfigPageSlots } from '@marinoscar/platform-web/ai/ui';
import { CardScanModelSection } from '../../components/settings/CardScanModelSection';

/**
 * Vault's slots on the packaged AI page. A module constant: a new object every
 * render would re-render the page's slot tree.
 */
const SLOTS: AiConfigPageSlots = {
  AfterContent: CardScanModelSection,
};

/**
 * The `AI` card of the Console (`/admin/settings/ai`, E8.2 #88): the platform AI
 * slice's `AiConfigPage` (switch AI on, the key policy, the OpenAI provider and
 * its write-only key, limits), gated on `ai_config:read` and editable with
 * `ai_config:write`, plus Vault's `Card scanning model` section in its
 * `AfterContent` slot (`ai.cardExtractModel`, saved through system settings).
 *
 * This is the card that switches AI on, so it is never hidden behind
 * `feature: 'ai'`. The page redirects to `/` without `ai_config:read` itself;
 * the route's `RequirePermission` and the API are the gates.
 */
export default function AiSettingsPage() {
  return <AiConfigPage slots={SLOTS} />;
}
