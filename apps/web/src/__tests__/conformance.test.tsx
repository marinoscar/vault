// =============================================================================
// Vault's web conformance entry (issue #101, E11.3)
// =============================================================================
//
// The web counterpart of `apps/api/test/conformance.spec.ts`: every invariant the platform enforces
// over what the web app DECLARES (its settings registries, its route table, its destinations) runs
// here through `runPlatformWebConformance()`, so the suite ids and cases are the same in every app
// that consumes `@marinoscar/platform-web`. This file passes Vault's DATA; the cases live in the
// package. The registries are the arrays the hub, the rail and the AppBar title run; the route table
// is the text of `App.tsx`; the permission ids are read from the API's own declarations.
//
// Vault-specific pins (which card has which permission, the controller mirror) stay in
// `config/settingsRegistry.test.ts` and `config/destinations.test.ts`.
// =============================================================================

import { runPlatformWebConformance } from '@marinoscar/platform-web/testing';
// Importing a slice's testing entry REGISTERS its suites with the harness.
import '@marinoscar/platform-web/settings/testing';
import '@marinoscar/platform-web/shell/testing';
import { DESTINATIONS, DESTINATION_ROUTES, UNOWNED_ROUTES, owns, resolveActiveDestination } from '@marinoscar/vault-web/navigation';

import { ADMIN_HUB_PATH, ADMIN_HUB_TITLE, ADMIN_SECTIONS } from '../config/adminSections';
import { USER_HUB_PATH, USER_HUB_TITLE, USER_SETTINGS_SECTIONS } from '../config/userSettingsSections';
import appSource from '../App.tsx?raw';
import { API_PERMISSIONS } from './config/apiPermissions';

runPlatformWebConformance({
  adminSections: ADMIN_SECTIONS,
  userSettingsSections: USER_SETTINGS_SECTIONS,
  hubs: {
    admin: { path: ADMIN_HUB_PATH, title: ADMIN_HUB_TITLE },
    user: { path: USER_HUB_PATH, title: USER_HUB_TITLE },
  },
  routes: { appTsx: appSource },
  apiPermissions: [...API_PERMISSIONS],
  destinations: {
    routes: DESTINATION_ROUTES,
    unowned: UNOWNED_ROUTES,
    owns,
    resolveActive: (pathname: string) => resolveActiveDestination(DESTINATION_ROUTES, pathname),
    destinations: DESTINATIONS.map((destination) => ({
      key: destination.key,
      path: destination.path,
      ...(destination.external ? { external: true } : {}),
    })),
  },
  suites: {
    'settings-ai-cards': {
      skip: 'The suite requires at least one per-user AI card (AI keys, ai:use) as a vacuity guard. Vault has no per-user AI key page: its one OpenAI key is the administrator\'s (write-only, AI rule 1 of AGENTS.md), so every AI card is an admin card. The same rules for the admin cards (ai_config:* permission, feature: \'ai\' except the AI card) are pinned by config/settingsRegistry.test.ts.',
    },
    'shell-local-host': {
      skip: 'Vault is a web app with a server: the packaged shell runs under the real identity and calls the API. The suite proves the shell in a single-user host with no API, which Vault is not.',
    },
  },
});
