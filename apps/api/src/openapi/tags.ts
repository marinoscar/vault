// =============================================================================
// OpenAPI tag taxonomy (issue #101, E11.3)
// =============================================================================
//
// Every `@ApiTags(...)` name used by a controller of this API (Vault's own and the packaged
// slices'), with a description and the sidebar section it belongs to. An undeclared tag fails the
// Spectral `operation-tag-defined` rule in CI (`npm run openapi:dump && npm run openapi:lint`),
// and an undescribed tag fails `tag-description`.
//
// Importing this file registers the taxonomy, in this order, into `openApiTags` (the registry of
// `@marinoscar/platform-api/core`); `document.ts` imports it, and the platform host builds the
// published `tags` and `x-tagGroups` from the registry. A new controller's tag is added here.
// =============================================================================

import { openApiTags } from '@marinoscar/platform-api/core';

interface AppOpenApiTag {
  /** Must match the controller's `@ApiTags(...)` argument byte-for-byte. */
  name: string;
  /** One or two sentences, rendered under the tag in the sidebar. */
  description: string;
}

interface AppOpenApiTagGroup {
  name: string;
  tags: AppOpenApiTag[];
}

const TAG_GROUPS: AppOpenApiTagGroup[] = [
  {
    name: 'Authentication & Access',
    tags: [
      { name: 'Authentication', description: 'Google OAuth sign-in, access-token refresh, logout and the current-user lookup. Every other section assumes a bearer token from one of these routes.' },
      { name: 'Device Authorization', description: 'RFC 8628 device authorization grant for the CLI and other browserless clients, plus management of the resulting device sessions.' },
      { name: 'Personal Access Tokens', description: 'Long-lived `pat_` bearer credentials for scripts and automation. A token carries the permission set of the user that minted it.' },
      { name: 'Allowlist', description: 'The email allowlist that gates who may sign in at all.' },
      { name: 'Users', description: 'User administration: list, inspect, activate and deactivate users and assign roles.' },
      { name: 'Roles', description: 'The role catalogue and the permissions each role grants.' },
      { name: 'Organizations', description: 'Organization administration for the deployment (the system view).' },
      { name: 'Organization Settings', description: 'Settings a single organization controls within the limits the deployment sets.' },
    ],
  },
  {
    name: 'Vault',
    tags: [
      { name: 'Secrets', description: 'Typed, versioned, encrypted secrets: logins, API keys, payment cards and notes, their versions, attachments, export and card scanning. Plaintext values appear only in a detail response.' },
      { name: 'Secret Types', description: 'The secret type catalogue: the read-only system types and administrator-defined custom types.' },
      { name: 'Media', description: 'Media folders and the files in them.' },
      { name: 'Backups', description: 'Encrypted secret backups: the administrator schedule and runs, and the caller\'s own "My backups". Archive passwords are write-only.' },
      { name: 'Exports', description: 'Platform data exports (`user-data` and `org-data`): sources, requests, status and signed downloads.' },
    ],
  },
  {
    name: 'Settings',
    tags: [
      { name: 'System Settings', description: 'Deployment-wide settings, read and written by namespace.' },
      { name: 'User Settings', description: 'The caller\'s own preferences: profile, appearance and notification choices.' },
      { name: 'Email Settings', description: 'The email transport (SES or SMTP) configured at runtime; secrets are write-only.' },
      { name: 'Storage', description: 'Object storage: upload, download and manage stored objects.' },
      { name: 'Storage Configuration', description: 'The object storage provider and its credentials, configured at runtime.' },
    ],
  },
  {
    name: 'AI',
    tags: [
      { name: 'AI', description: 'Consumer AI routes behind the AI kill switch and the `ai:use` permission. Provider calls are server-side only.' },
      { name: 'AI Administration', description: 'AI configuration, the model catalogue and usage. Always reachable so an administrator can turn AI back on.' },
    ],
  },
  {
    name: 'Notifications',
    tags: [
      { name: 'Notifications', description: 'The caller\'s notifications, preferences and the in-app stream.' },
      { name: 'Notification Broadcasts', description: 'Administrator announcements to every user or an audience.' },
      { name: 'Push Configuration', description: 'Web Push (VAPID) configuration, managed at runtime.' },
    ],
  },
  {
    name: 'Operations',
    tags: [
      { name: 'Health', description: 'Liveness and readiness probes. Public.' },
      { name: 'About', description: 'Build and deployment information for administrators.' },
      { name: 'Doctor', description: 'Read-only health checks with a remedy for each failure, and a redacted support bundle.' },
      { name: 'Maintenance', description: 'Maintenance mode: status and the administrator switch.' },
      { name: 'Jobs', description: 'The background job queue: list, inspect, retry and cancel jobs.' },
      { name: 'Worker Nodes', description: 'The worker-node fleet: enrolment, claims, heartbeats and job results.' },
      { name: 'Database Backup', description: 'Database backups and restore: schedule, runs, downloads and the guarded restore.' },
      { name: 'Telemetry', description: 'The telemetry store connection, dashboards and the query explorer.' },
      { name: 'Onboarding', description: 'First-run onboarding steps for the caller and the administrator activation metrics.' },
    ],
  },
  {
    name: 'Data Lifecycle',
    tags: [
      { name: 'User data', description: 'Delete the caller\'s own data by scope (the Danger Zone) and follow the purge job.' },
      { name: 'Factory reset', description: 'Reset the whole deployment. System administrators only; back up first.' },
      { name: 'Organization offboarding', description: 'Offboard an organization, subject to registered preconditions.' },
    ],
  },
];

openApiTags.registerAll(
  TAG_GROUPS.flatMap((group) => group.tags.map((tag) => ({ ...tag, group: group.name }))),
);
