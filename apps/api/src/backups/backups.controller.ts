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
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../common/constants/roles.constants';
import { BackupsService } from './backups.service';
import { BackupRunListQueryDto } from './dto/backup-run-list-query.dto';
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

  @Get()
  @Auth({ permissions: [PERMISSIONS.SYSTEM_SETTINGS_READ] })
  @ApiOperation({
    summary: 'List backup runs',
    description: 'Newest first, paginated. Requires system_settings:read.',
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
