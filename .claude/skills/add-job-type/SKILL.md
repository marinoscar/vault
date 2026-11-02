---
name: add-job-type
description: Add a background job type to the platform job queue - implement a JobHandler, self-register it, enqueue it through JobsService with an explicit orgId, declare its label and execution profile, decide node eligibility, and add the tests that pin it. Applies once E5 (jobs and nodes) has landed; before that, use it as the design target when touching the in-process backup runner. Use when a feature must do long-running work or when a @Cron or @OnEvent body would otherwise work inline.
---

# Add a job type

> **In force** (E5.1 mounted the queue; E5.2 moved backups onto it). The worked example in this repo is `apps/api/src/backups/` (`jobs/` handlers, `backup-queue.service.ts`, `backup-schedule.task.ts`). Do not add an in-process runner.

The queue and the worker-node fleet are the platform's: `@marinoscar/platform-api/jobs` and `@marinoscar/platform-api/nodes`. Vault owns only handlers and their host ports (`apps/api/src/platform/jobs/`, created in E5). The contract is the package README (`node_modules/@marinoscar/platform-api/README.md`) and the TSDoc of `JobHandler` in the installed package; the recipe and rules originate in EAB `packages/platform-api/src/jobs/handlers/README.md` and `docs/specs/job-queue.md`.

## Steps

1. Create the handler beside the feature: a class implementing `JobHandler` with a dotted lowercase `type` (Vault's are `vault.<area>.<verb>`, e.g. `vault.backup.run`, `vault.user_backup.run`), a sentence-case `label`, and `process(job)`. Throw to fail; return normally when the work committed. Be idempotent: the queue is at-least-once.
2. Self-register in `onModuleInit` with the injected `JobHandlerRegistry`; add the class to the feature module's `providers`.
3. Enqueue through `JobsService.enqueue` (or `enqueueWithin(tx, ...)`) with identifiers in `payload`, never copies of data (never a secret, password or decrypted value). **Pass `orgId` explicitly**: `null` for housekeeping and system jobs; the default organization's id for a handler that touches an org table (run it under `JobScope.run(job, fn)`).
4. A `@Cron` only decides whether work is due and enqueues via `enqueueHousekeepingJob`. An `@OnEvent` body enqueues; it never dumps, uploads or spawns.
5. Declare `profile` `{ maxRuntimeMs, maxAttempts }` or take the default. Never add `leaseMs` or `heartbeatMs`.
6. Write the handler spec and add the type string to the job-type snapshot spec (append only).

## Vault rules

- **Backup and AI jobs are server-only**: no `nodeResultSchema`, no `persistNodeResult`. They hold the archive password or `VAULT_ENCRYPTION_KEY`-protected data and must never reach a worker node.
- The backup archive streams into object storage (never buffered); the upload and the dump's exit code are both awaited. The backup password is decrypted in memory only, never logged, never in a job payload or error.
- A job `type` string is permanent once jobs of that type exist; a rename is a new type.
- Active-run uniqueness (one running scheduled backup; one per user for My backups) is the queue's dedup key (done in E5.2); never add an advisory lock. A route that needs the 409 and its own row writes both in one `prisma.$transaction` with `JobsService.enqueueWithin` and maps `isActiveDedupConflict` to `ConflictException`.
- A retry must not double-write: a `backup_runs` row is created once and reused.

## Verify

`cd apps/api && npm run typecheck && npm test`, plus the platform `cron-enqueue-only` and `on-event-no-io` conformance suites once E11 wires `runPlatformConformance`. Delegate to `backend-dev`, then `testing-dev`.
