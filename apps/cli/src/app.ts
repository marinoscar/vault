import { APP_NAME, CLI_NAME, REPO_SLUG } from '@app/shared';
import { githubRawManifest, type CreateCliOptions } from '@marinoscar/platform-cli';

import { vaultCommands } from './vault/register.js';
import { readVersion } from './version.js';

// =============================================================================
// The vault CLI: the platform CLI with Vault's domain commands
// =============================================================================
//
// `init`, `login` (device flow), `api`, `config`, `node` and `deploy`, the TUI
// and the deploy pipeline are `@marinoscar/platform-cli`'s. Vault adds the
// domain command groups in src/vault/ (secrets, versions, types, health, sync,
// backup, admin, auth, menu) through `extraCommands`. The binary name, the config
// directory (~/.vault) and the environment prefix (VAULT_) derive from `CLI_NAME`
// (`cliName` in packages/shared/identity.json).
// =============================================================================

export { readVersion };

/**
 * The manifests the deploy version step writes the app release version into.
 * `apps/cli` is deliberately absent: the CLI keeps its own version
 * (`apps/cli/package.json`, bumped per PR), so a release must not rewrite it.
 * The first entry is the version source.
 */
export const APP_VERSIONED_MANIFESTS: readonly string[] = [
  'apps/api/package.json',
  'apps/web/package.json',
  'packages/shared/package.json',
];

/** Where the start-up update notice reads the newest CLI version: `apps/cli/package.json` on `main`. */
export const APP_UPGRADE_HINT = 'git pull && npm ci && npm run build --workspace=cli';

export const APP_CLI_OPTIONS: CreateCliOptions = {
  identity: {
    name: CLI_NAME,
    displayName: `${APP_NAME} CLI`,
    productName: APP_NAME,
    repoSlug: REPO_SLUG,
  },
  version: readVersion(),
  extraCommands: vaultCommands,
  deploy: { versionedManifests: APP_VERSIONED_MANIFESTS },
  updateNotice: {
    latestVersion: githubRawManifest({ repo: REPO_SLUG, ref: 'main', path: 'apps/cli/package.json' }),
    upgradeHint: APP_UPGRADE_HINT,
  },
};
