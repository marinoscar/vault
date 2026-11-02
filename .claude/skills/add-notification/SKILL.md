---
name: add-notification
description: Add a notification event to the platform notifications slice - write the email template, declare the event with registerNotification, add it to the manifest, and call notify() after the triggering write commits. Applies once E7 (email and notifications) has landed; Vault has no notification system before that. Use when a feature must tell a user something over email, the in-app bell or Web Push.
---

# Add a notification

> **Applies from E7** (programme epic #54). Vault has no dispatcher, channels or preferences today; do not build a local one. Candidate events for E7 are listed on its issue (backup failed, scheduled backup completed, card expiring, allowlist invitation, role changed).

Email, notifications, broadcasts and Web Push are platform slices: `@marinoscar/platform-api/email`, `@marinoscar/platform-api/notifications`, and on the web `@marinoscar/platform-web/notifications/{headless,ui}`. Vault owns three things: **email templates** (`apps/api/src/email-templates/`), **event registrations** (`apps/api/src/notifications-registry/`) and **the call sites**. Contract: the package READMEs (`packages/platform-api/src/notifications/README.md` and `email/README.md` in EAB, also in the installed package) and `docs/specs/browser-notifications.md` upstream.

## Steps

1. **Template** (only if the event declares `email`): `apps/api/src/email-templates/<name>.email.ts`, a pure function returning `{ subject, html, text }`, built with the `html` tag (every interpolation escaped), `renderLayout` and `safeUrl`; declare its data type via `EmailTemplateDataMap` augmentation; register it. A platform-shipped template (`role-changed`, `broadcast`, `backup-failed`, `restore-completed`, `test-email`) is bound by name, not rewritten. Template names are persisted: never rename one.
2. **Event** in `apps/api/src/notifications-registry/<domain>.notifications.ts`: stable dotted lowercase `key`, `label`, `description`, `channels`, `defaultEnabled`, `mandatory` only for security-relevant events, `emailTemplate`, optional `browserTemplate` (root-relative `link`).
3. **Manifest**: add the array to the platform notification manifest in `apps/api/src/platform/notifications/` (order fixed: channels, email rendering, templates, notifications).
4. **Call `notify()`** from a service that injects `NotificationsService`, **after** the triggering write has committed and **outside** any `$transaction`. It is detached and never rejects.
5. **Tests**: the events spec, a snapshot spec beside the template, and the `notifications`/`email` conformance suites.

## Vault rules

- A notification payload and template **never contain a secret value, card number, backup password, download URL with embedded credentials or attachment content**. Reference by id and name only; a backup-failed email says which backup failed, not what was in it.
- Event keys, channel ids and template names are persisted: a rename is a new event.
- A notification is never a long-running job; do not render or send inline in a handler.
- Examples and fixtures use `@example.test` addresses and invented names.

Delegate to `backend-dev`, then `testing-dev`.
