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
  Query,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/interfaces/authenticated-user.interface';
import { PERMISSIONS } from '../common/constants/roles.constants';
import {
  EXPORT_SECRETS_BODY_SCHEMA,
  parseExportSecretsBody,
} from '../secrets/dto/export-secrets.dto';
import { MyBackupsService } from './my-backups.service';
import { BackupRunListQueryDto } from './dto/backup-run-list-query.dto';

/**
 * The caller's backups saved to object storage. Requires `secrets:read`
 * (the same as downloading a backup); every route is limited to the caller's
 * own saved backups, and another user's id answers 404.
 */
@ApiTags('Backups')
@Controller('backups/me')
export class MyBackupsController {
  constructor(private readonly myBackups: MyBackupsService) {}

  @Get('config')
  @Auth({ permissions: [PERMISSIONS.SECRETS_READ] })
  @ApiOperation({
    summary: 'Whether saving backups to storage is available',
    description: 'Returns { storageConfigured, keepCount }. Requires secrets:read.',
  })
  @ApiResponse({ status: 200, description: '{ storageConfigured: boolean, keepCount: 10 }' })
  getConfig() {
    return this.myBackups.getConfig();
  }

  @Post()
  @Auth({ permissions: [PERMISSIONS.SECRETS_READ] })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Save a backup of your data to the storage account',
    description:
      'Same body and zip as POST /api/secrets/export, built in the background and stored under ' +
      'user-backups/<your id>/. The password is used only while building and is never stored. ' +
      'Keeps your 10 most recent saved backups. Audited as backups.user.run. Requires secrets:read.',
  })
  @ApiBody({ schema: EXPORT_SECRETS_BODY_SCHEMA })
  @ApiResponse({ status: 202, description: 'BackupRunResponse (status running)' })
  @ApiResponse({ status: 400, description: 'Validation error, or storage is not configured' })
  @ApiResponse({ status: 409, description: 'You already have a backup running' })
  async runNow(
    // Parsed by hand (specific 400 messages); the body holds the password and is never logged.
    @Body() body: unknown,
    @CurrentUser() user: RequestUser,
  ) {
    return this.myBackups.runNow({ id: user.id, email: user.email }, parseExportSecretsBody(body));
  }

  @Get()
  @Auth({ permissions: [PERMISSIONS.SECRETS_READ] })
  @ApiOperation({
    summary: 'List your saved backups',
    description: 'Newest first, paginated, same shape as the admin list. Requires secrets:read.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiResponse({ status: 200, description: '{ items: BackupRunResponse[], total, page, pageSize, totalPages }' })
  async listRuns(@Query() query: BackupRunListQueryDto, @CurrentUser('id') userId: string) {
    return this.myBackups.listRuns(userId, query);
  }

  @Get(':id/download')
  @Auth({ permissions: [PERMISSIONS.SECRETS_READ] })
  @ApiOperation({
    summary: 'Get a download link for one of your saved backups',
    description:
      'Signed URL valid for 300 seconds, served as an attachment. Audited as backups.user.download. ' +
      'Requires secrets:read.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: '{ url, expiresAt, fileName }' })
  @ApiResponse({ status: 404, description: 'Not yours, unknown, failed, running or deleted' })
  async getDownload(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return this.myBackups.getDownload(id, userId);
  }

  @Delete(':id')
  @Auth({ permissions: [PERMISSIONS.SECRETS_READ] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete one of your saved backups',
    description:
      'Deletes the object and sets deletedAt; the run stays in your list. Audited as ' +
      'backups.user.delete. Requires secrets:read.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Not yours or unknown' })
  @ApiResponse({ status: 409, description: 'The backup is still running' })
  async deleteRun(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string): Promise<void> {
    await this.myBackups.deleteRun(id, userId);
  }
}
