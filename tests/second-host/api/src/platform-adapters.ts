// Host Beta's adapters for the PLATFORM's host ports: the smallest binding of each, as in the
// EnterpriseAppBase starter. Nothing here is about Vault; `vault-bindings.ts` is.
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { AuditEventInput, AuditSink, SystemSettingsSnapshot, SystemSettingsStore } from '@marinoscar/platform-api/core';
import type {
  AllowlistInvitationNotice,
  IdentityJobHandler,
  IdentityJobsPort,
  IdentityNotifier,
  IdentityProfileImages,
  OrgInvitationNotice,
  RoleChangedNotice,
  UserDefaults,
  UserWelcomeNotice,
} from '@marinoscar/platform-api/identity';
import { JobHandlerRegistry, JobsService, enqueueHousekeepingJob } from '@marinoscar/platform-api/jobs';
import {
  DEFAULT_USER_SETTINGS,
  SystemSettingsService,
  currentPatchSystemSettingsSchema,
  type NormalizedProfileSettings,
  type SettingsDataPort,
  type SettingsOrgTx,
  type SettingsProfileImages,
} from '@marinoscar/platform-api/settings';
import { normalizeProfileSettings, resolveProfileImageUrl } from '@marinoscar/platform-api/storage';

import { PrismaService } from './prisma.service';

/** `AUDIT_SINK`: packaged slices audit into `audit_events`. */
@Injectable()
export class PrismaAuditSink implements AuditSink {
  constructor(private readonly prisma: PrismaService) {}

  async record(event: AuditEventInput): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: event.actorUserId,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        ...(event.meta === undefined ? {} : { meta: event.meta as never }),
      },
    });
  }
}

/** `SYSTEM_SETTINGS_STORE`: one namespace of the system settings document. */
@Injectable()
export class SystemSettingsStoreAdapter implements SystemSettingsStore {
  constructor(private readonly settings: SystemSettingsService) {}

  async read(namespace: string): Promise<SystemSettingsSnapshot> {
    const document = (await this.settings.getSettings()) as unknown as Record<string, unknown> & { version: number };
    return { value: document[namespace], version: document.version };
  }

  async patch(namespace: string, patch: Record<string, unknown>, ctx: { actorUserId: string; ifMatchVersion?: number }): Promise<SystemSettingsSnapshot> {
    const parsed = currentPatchSystemSettingsSchema().safeParse({ [namespace]: patch });
    if (!parsed.success) throw new BadRequestException(`Invalid "${namespace}" settings patch`);
    const document = (await this.settings.patchSettings(
      parsed.data as Parameters<SystemSettingsService['patchSettings']>[0],
      ctx.actorUserId,
      ctx.ifMatchVersion,
    )) as unknown as Record<string, unknown> & { version: number };
    return { value: document[namespace], version: document.version };
  }
}

/** `SETTINGS_DATA`: the org layer's transaction, in the organization's row-level-security scope. */
@Injectable()
export class SettingsDataAdapter implements SettingsDataPort {
  constructor(private readonly prisma: PrismaService) {}

  runInOrg<R>(scope: { orgId: string; userId?: string }, fn: (tx: SettingsOrgTx) => Promise<R>): Promise<R> {
    return this.prisma.runInOrg(scope.orgId, (tx) => fn(tx as SettingsOrgTx), scope.userId === undefined ? {} : { userId: scope.userId });
  }
}

/** `IDENTITY_PROFILE_IMAGES` and `SETTINGS_PROFILE_IMAGES`: the provider's picture; no upload. */
@Injectable()
export class HostProfileImages implements IdentityProfileImages, SettingsProfileImages {
  resolveImageUrl(user: { id: string; providerProfileImageUrl: string | null }, storedProfile: unknown): string | null {
    return resolveProfileImageUrl(user, storedProfile);
  }

  hasUploadedImage(storedProfile: unknown): boolean {
    return normalizeProfileSettings(storedProfile).imageObjectId !== null;
  }

  normalize(stored: unknown): NormalizedProfileSettings {
    return normalizeProfileSettings(stored);
  }

  async isUploadedAvatar(): Promise<boolean> {
    return false;
  }
}

/** `USER_DEFAULTS`: a new user's settings document. */
@Injectable()
export class HostUserDefaults implements UserDefaults {
  userSettings(): Record<string, unknown> {
    return structuredClone(DEFAULT_USER_SETTINGS) as unknown as Record<string, unknown>;
  }
}

/** `IDENTITY_NOTIFIER`: logs each notice (the host mounts no notifications slice). */
@Injectable()
export class LoggingIdentityNotifier implements IdentityNotifier {
  private readonly logger = new Logger('HostBetaIdentityNotifier');

  async roleChanged(userId: string, notice: RoleChangedNotice): Promise<void> {
    this.logger.log(`roles of ${userId} changed to ${notice.currentRoles.join(', ')}`);
  }

  async userWelcomed(userId: string, _notice: UserWelcomeNotice): Promise<void> {
    this.logger.log(`welcome notice for ${userId}`);
  }

  async allowlistInvitation(email: string, _notice: AllowlistInvitationNotice): Promise<void> {
    this.logger.log(`allowlist invitation for ${email}`);
  }

  async orgInvitation(email: string, notice: OrgInvitationNotice): Promise<void> {
    this.logger.log(`invitation to ${notice.orgName} for ${email}`);
  }
}

/** `IDENTITY_JOBS`: identity's housekeeping jobs on the platform queue. */
@Injectable()
export class IdentityJobsAdapter implements IdentityJobsPort {
  constructor(
    private readonly jobs: JobsService,
    private readonly registry: JobHandlerRegistry,
    private readonly prisma: PrismaService,
  ) {}

  async enqueueHousekeepingJob(options: { type: string; what: string; logger: Logger }): Promise<void> {
    await enqueueHousekeepingJob({ jobs: this.jobs, prisma: this.prisma as never, ...options });
  }

  registerHandler(handler: IdentityJobHandler): void {
    this.registry.register(handler);
  }
}
