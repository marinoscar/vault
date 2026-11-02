import { PersonalAccessTokens } from '../../components/settings/PersonalAccessTokens';
import { SettingsPageFrame } from '../../components/settings/SettingsPageFrame';

/**
 * The `Access tokens` card of `/settings` (`/settings/tokens`, E10.3 #94):
 * the personal access tokens section, unchanged (one-time reveal kept).
 * `pat.controller.ts` is ownership-scoped (bare `@Auth()`): no permission.
 */
export default function AccessTokensPage() {
  return (
    <SettingsPageFrame title="Access tokens" description="Personal access tokens for the CLI and scripts">
      <PersonalAccessTokens />
    </SettingsPageFrame>
  );
}
