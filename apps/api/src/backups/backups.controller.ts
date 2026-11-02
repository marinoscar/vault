import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FastifyReply } from 'fastify';

import { Auth, CurrentUser } from '@marinoscar/platform-api/identity';
import { PERMISSIONS } from '../common/constants/roles.constants';
import { BackupsService } from './backups.service';
import { BackupRunListQueryDto } from './dto/backup-run-list-query.dto';
import {
  EXPORT_SYSTEM_BACKUP_BODY_SCHEMA,
  parseExportSystemBackupBody,
} from './dto/export-system-backup.dto';
import {
  parseUpdateBackupScheduleBody,
  UPDATE_BACKUP_SCHEDULE_BODY_SCHEMA,
} from './dto/update-backup-schedule.dto';

/**
 * Admin-scheduled system backups: an AES-256 zip of every user's vault data,
 * written to object storage on a schedule. Reads need `system_settings:read`;
 * everything that changes state or hands out the archive needs
 * `system_settings:write`.
 */
@ApiTags('Backups')
@Controller('admin/backups')
export class BackupsController {
  constructor(private readonly backupsService: BackupsService) {}

  @Get('schedule')
  @Auth({ permissions: [PERMISSIONS.SYSTEM_SETTINGS_READ] })
  @ApiOperation({
    summary: 'Get the backup schedule',
    description:
      'Returns the schedule with passwordConfigured, passwordUpdatedAt, nextRunAt, lastRunAt and ' +
      'storageConfigured. Never returns the password or its ciphertext. Defaults (disabled, daily ' +
      '03:00 UTC, keep 7) when none is saved. Requires system_settings:read.',
  })
  @ApiResponse({ status: 200, description: 'BackupScheduleResponse' })
  async getSchedule() {
    return this.backupsService.getSchedule();
  }

  @Put('schedule')
  @Auth({ permissions: [PERMISSIONS.SYSTEM_SETTINGS_WRITE] })
  @ApiOperation({
    summary: 'Replace the backup schedule',
    description:
      'Full replace of the editable fields. password is write-only: omit it to keep the stored one. ' +
      'Enabling requires a password (stored or in this request) and configured object storage. ' +
      'Content: includeSecrets (default true), includeAttachments/includeVersions (require secrets), ' +
      'includeMedia and includeSystem (default false); at least one of secrets/media/system. ' +
      'Recomputes nextRunAt. Audited as backups.schedule.update (changed field names only). ' +
      'Requires system_settings:write.',
  })
  @ApiBody({ schema: UPDATE_BACKUP_SCHEDULE_BODY_SCHEMA })
  @ApiResponse({ status: 200, description: 'BackupScheduleResponse' })
  @ApiResponse({ status: 400, description: 'Validation error, or enabling without password/storage' })
  async updateSchedule(
    // Parsed by hand so a 400 carries the specific message; the body
    // (which may hold the password) is never logged.
    @Body() body: unknown,
    @CurrentUser('id') userId: string,
  ) {
    return this.backupsService.updateSchedule(parseUpdateBackupScheduleBody(body), userId);
  }

  @Post('run')
  @Auth({ permissions: [PERMISSIONS.SYSTEM_SETTINGS_WRITE] })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Run a backup now',
    description:
      'Starts a manual backup and returns the running run (202). Audited as backups.run. ' +
      'Requires system_settings:write.',
  })
  @ApiResponse({ status: 202, description: 'BackupRunResponse (status running)' })
  @ApiResponse({ status: 409, description: 'A backup is already running' })
  async runNow(@CurrentUser('id') userId: string) {
    return this.backupsService.runNow(userId);
  }

  @Post('export')
  @Auth({ permissions: [PERMISSIONS.SYSTEM_SETTINGS_WRITE] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Download a system backup now',
    description:
      'Streams an AES-256 encrypted zip with the same layout as a scheduled backup (index.json, ' +
      'users/NNNN/..., system/...), built from the chosen contents. Nothing is stored and no run is ' +
      'recorded. Give exactly one of password and useScheduledPassword: true. Audited as ' +
      'backups.export (contents and counts, never the password). Requires system_settings:write.',
  })
  @ApiBody({ schema: EXPORT_SYSTEM_BACKUP_BODY_SCHEMA })
  @ApiProduces('application/zip')
  @ApiResponse({
    status: 200,
    description: 'The encrypted zip archive',
    content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } },
    headers: {
      'Content-Disposition': {
        description: 'attachment; filename="vault-backup-YYYY-MM-DD_HHmmss.zip" (UTC)',
        schema: { type: 'string' },
      },
      'X-Vault-Export-Users': { description: 'Number of users in index.json', schema: { type: 'integer' } },
      'X-Vault-Export-Secrets': { description: 'Number of secrets', schema: { type: 'integer' } },
      'X-Vault-Export-Attachments': { description: 'Number of attachment files', schema: { type: 'integer' } },
      'X-Vault-Export-Media-Files': { description: 'Number of media files', schema: { type: 'integer' } },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Validation error (no or two password sources, nothing selected, ...) or no scheduled password set',
  })
  async exportNow(
    // Parsed by hand so a 400 carries the specific message; never logged.
    @Body() body: unknown,
    @CurrentUser('id') userId: string,
    // NOT passthrough: the zip is written straight to the reply, so the platform
    // `{ data }` envelope (which wraps a StreamableFile) never touches it.
    @Res() reply: FastifyReply,
  ): Promise<FastifyReply> {
    const result = await this.backupsService.exportNow(parseExportSystemBackupBody(body), userId);

    reply.header('Cache-Control', 'no-store');
    reply.header('X-Vault-Export-Users', String(result.userCount));
    reply.header('X-Vault-Export-Secrets', String(result.secretCount));
    reply.header('X-Vault-Export-Attachments', String(result.attachmentCount));
    reply.header('X-Vault-Export-Media-Files', String(result.mediaFileCount));

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${result.fileName}"`);

    // The raw zip, streamed. The platform TransformInterceptor wraps a returned
    // StreamableFile in `{ data }`, so the stream is sent on the reply instead.
    return reply.send(result.stream);
  }

  @Get()
  @Auth({ permissions: [PERMISSIONS.SYSTEM_SETTINGS_READ] })
  @ApiOperation({
    summary: 'List backup runs',
    description:
      'System backups only (never a backup a user saved to storage). ' +
      'Newest first, paginated. Each run carries mediaFileCount and contents (the content keys it ' +
      'was made with: secrets, attachments, versions, media, system). Requires system_settings:read.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiResponse({ status: 200, description: '{ items: BackupRunResponse[], total, page, pageSize, totalPages }' })
  async listRuns(@Query() query: BackupRunListQueryDto) {
    return this.backupsService.listRuns(query);
  }

  @Get(':id/download')
  @Auth({ permissions: [PERMISSIONS.SYSTEM_SETTINGS_WRITE] })
  @ApiOperation({
    summary: 'Get a download link for a backup',
    description:
      'Returns a signed URL valid for 300 seconds, served as an attachment named fileName. ' +
      'Audited as backups.download. Requires system_settings:write.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: '{ url, expiresAt, fileName }' })
  @ApiResponse({ status: 404, description: 'Unknown, failed, running or deleted backup' })
  async getDownload(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return this.backupsService.getDownload(id, userId);
  }

  @Delete(':id')
  @Auth({ permissions: [PERMISSIONS.SYSTEM_SETTINGS_WRITE] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a backup',
    description:
      'Deletes the object from storage and sets deletedAt; the run stays in the history. ' +
      'Audited as backups.delete. Requires system_settings:write.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Backup not found' })
  @ApiResponse({ status: 409, description: 'The backup is still running' })
  async deleteRun(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string): Promise<void> {
    await this.backupsService.deleteRun(id, userId);
  }
}
