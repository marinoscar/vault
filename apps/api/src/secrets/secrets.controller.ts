import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiBody,
  ApiProduces,
} from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';
import { FastifyReply } from 'fastify';

import { Auth, CurrentUser, RequestUser } from '@marinoscar/platform-api/identity';
import { PERMISSIONS } from '../common/constants/roles.constants';

import { SecretsService } from './secrets.service';
import { SecretsExportService } from './export/secrets-export.service';
import {
  EXPORT_SECRETS_BODY_SCHEMA,
  parseExportSecretsBody,
} from './dto/export-secrets.dto';
import { CreateSecretDto } from './dto/create-secret.dto';
import { UpdateSecretDto } from './dto/update-secret.dto';
import { RenewSecretDto } from './dto/renew-secret.dto';
import {
  SecretListQueryDto,
  secretListQuerySchema,
} from './dto/secret-list-query.dto';
import { LinkAttachmentDto } from './dto/link-attachment.dto';
import {
  AttachmentListQueryDto,
  attachmentListQuerySchema,
} from './dto/attachment-list-query.dto';

@ApiTags('Secrets')
@Controller('secrets')
export class SecretsController {
  constructor(
    private readonly secretsService: SecretsService,
    private readonly secretsExportService: SecretsExportService,
  ) {}

  // ---------------------------------------------------------------------------
  // Backup export
  // ---------------------------------------------------------------------------

  @Post('export')
  @Auth({ permissions: [PERMISSIONS.SECRETS_READ] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Download a password-protected backup of the secrets you own',
    description:
      'Streams an AES-256 encrypted zip (WinZip AE-2). README.txt is always present and lists what ' +
      'is included. With includeSecrets (default true): secrets.html, secrets.json and, unless ' +
      'excluded, the attachment files. With includeMedia (default false): media/media.json and the ' +
      'files of the media folders the caller owns. At least one of the two is required; ' +
      'includeAttachments/includeVersions true require includeSecrets; includeSystem is rejected ' +
      '(scheduled system backups only). ' +
      'Only data the caller owns is exported, even with secrets:read_any or media:read_any. ' +
      'The password is never stored or logged and cannot be recovered. ' +
      'Requires secrets:read.',
  })
  @ApiBody({ schema: EXPORT_SECRETS_BODY_SCHEMA })
  @ApiProduces('application/zip')
  @ApiResponse({
    status: 200,
    description: 'The encrypted zip archive',
    content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } },
    headers: {
      'Content-Disposition': {
        description: 'attachment; filename="vault-backup-YYYY-MM-DD.zip" (UTC date)',
        schema: { type: 'string' },
      },
      'X-Vault-Export-Secrets': {
        description: 'Number of secrets in the archive',
        schema: { type: 'integer' },
      },
      'X-Vault-Export-Attachments': {
        description: 'Number of attachment files in the archive',
        schema: { type: 'integer' },
      },
      'X-Vault-Export-Media-Files': {
        description: 'Number of media library files in the archive (0 unless includeMedia)',
        schema: { type: 'integer' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Validation error (e.g. "Password must be at least 6 characters", ' +
      '"Choose at least one thing to back up")',
  })
  @ApiResponse({ status: 403, description: 'Missing secrets:read' })
  async exportSecrets(
    // Parsed by hand (not via the global ZodValidationPipe) so a failure
    // returns the specific message the contract promises; see
    // parseExportSecretsBody. The body is never logged.
    @Body() body: unknown,
    @CurrentUser() user: RequestUser,
    // NOT passthrough: the zip is written straight to the reply, so the platform
    // `{ data }` envelope (which wraps a StreamableFile) never touches it.
    @Res() reply: FastifyReply,
  ): Promise<FastifyReply> {
    const options = parseExportSecretsBody(body);
    const result = await this.secretsExportService.createExport(user, options);

    reply.header('Cache-Control', 'no-store');
    reply.header('X-Vault-Export-Secrets', String(result.secretCount));
    reply.header('X-Vault-Export-Attachments', String(result.attachmentCount));
    reply.header('X-Vault-Export-Media-Files', String(result.mediaFileCount));

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${result.fileName}"`);

    // The raw zip, streamed. The platform TransformInterceptor wraps a returned
    // StreamableFile in `{ data }`, so the stream is sent on the reply instead.
    return reply.send(result.stream);
  }

  // ---------------------------------------------------------------------------
  // Secrets CRUD
  // ---------------------------------------------------------------------------

  @Post()
  @Auth({ permissions: [PERMISSIONS.SECRETS_WRITE] })
  @ApiOperation({ summary: 'Create a new secret' })
  @ApiResponse({ status: 201, description: 'Secret created successfully' })
  @ApiResponse({ status: 400, description: 'Validation error or unknown type' })
  async create(
    @Body() dto: CreateSecretDto,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.secretsService.create(dto, user.id, user.permissions);
    return { data: result };
  }

  @Get()
  @Auth({ permissions: [PERMISSIONS.SECRETS_READ] })
  @ApiOperation({ summary: 'List secrets (metadata only, no decryption)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'typeId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['createdAt', 'name', 'updatedAt'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiResponse({ status: 200, description: 'Paginated list of secrets' })
  async findAll(
    @Query(new ZodValidationPipe(secretListQuerySchema)) query: SecretListQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.secretsService.findAll(query, user.id, user.permissions);
    return { data: result };
  }

  @Get('by-name/:name')
  @Auth({ permissions: [PERMISSIONS.SECRETS_READ] })
  @ApiOperation({ summary: 'Get secret by name (with decrypted current version data)' })
  @ApiParam({ name: 'name', type: String, description: 'Secret name' })
  @ApiResponse({ status: 200, description: 'Secret with decrypted data' })
  @ApiResponse({ status: 404, description: 'Secret not found' })
  async findByName(
    @Param('name') name: string,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.secretsService.findByName(name, user.id, user.permissions);
    return { data: result };
  }

  @Get(':id')
  @Auth({ permissions: [PERMISSIONS.SECRETS_READ] })
  @ApiOperation({ summary: 'Get secret with decrypted current version data' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Secret ID' })
  @ApiResponse({ status: 200, description: 'Secret with decrypted data' })
  @ApiResponse({ status: 404, description: 'Secret not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.secretsService.findOne(id, user.id, user.permissions);
    return { data: result };
  }

  @Put(':id')
  @Auth({ permissions: [PERMISSIONS.SECRETS_WRITE] })
  @ApiOperation({
    summary: 'Update secret metadata and/or data',
    description: 'Updating data creates a new immutable version.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Secret ID' })
  @ApiResponse({ status: 200, description: 'Secret updated successfully' })
  @ApiResponse({ status: 404, description: 'Secret not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSecretDto,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.secretsService.update(id, dto, user.id, user.permissions);
    return { data: result };
  }

  @Delete(':id')
  @Auth({ permissions: [PERMISSIONS.SECRETS_DELETE] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete secret and all its versions' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Secret ID' })
  @ApiResponse({ status: 204, description: 'Secret deleted successfully' })
  @ApiResponse({ status: 404, description: 'Secret not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    await this.secretsService.remove(id, user.id, user.permissions);
  }

  // ---------------------------------------------------------------------------
  // Version history
  // ---------------------------------------------------------------------------

  @Get(':id/versions')
  @Auth({ permissions: [PERMISSIONS.SECRETS_READ] })
  @ApiOperation({ summary: 'List all versions of a secret (metadata only)' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Secret ID' })
  @ApiResponse({ status: 200, description: 'Version list' })
  async findVersions(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.secretsService.findVersions(id, user.id, user.permissions);
    return { data: result };
  }

  @Get(':id/versions/:versionId')
  @Auth({ permissions: [PERMISSIONS.SECRETS_READ] })
  @ApiOperation({ summary: 'Get a specific version with decrypted data' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Secret ID' })
  @ApiParam({ name: 'versionId', type: String, format: 'uuid', description: 'Version ID' })
  @ApiResponse({ status: 200, description: 'Version with decrypted data' })
  @ApiResponse({ status: 404, description: 'Secret or version not found' })
  async findVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.secretsService.findVersion(id, versionId, user.id, user.permissions);
    return { data: result };
  }

  @Post(':id/versions/:versionId/rollback')
  @Auth({ permissions: [PERMISSIONS.SECRETS_WRITE] })
  @ApiOperation({
    summary: 'Rollback to a previous version',
    description: 'Creates a new version with the data from the specified old version.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Secret ID' })
  @ApiParam({ name: 'versionId', type: String, format: 'uuid', description: 'Target version ID' })
  @ApiResponse({ status: 201, description: 'Rollback completed, new version created' })
  async rollback(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.secretsService.rollback(id, versionId, user.id, user.permissions);
    return { data: result };
  }

  @Post(':id/renew')
  @Auth({ permissions: [PERMISSIONS.SECRETS_WRITE] })
  @ApiOperation({
    summary: 'Renew a secret with new values and replacement files',
    description:
      'For a card that has been reissued, expired, or replaced after fraud. ' +
      'Creates the next version from the supplied data and swaps only the ' +
      'attachment roles present in the request; every other file is carried ' +
      'forward. The previous version keeps its own values AND its own images, ' +
      'so the old card stays readable in the version history. Version bump, ' +
      'carry-forward and replacement insert all happen in one transaction.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Secret ID' })
  @ApiResponse({ status: 201, description: 'Renewal completed, new version created' })
  @ApiResponse({
    status: 400,
    description:
      'Data failed type validation, duplicate attachment entries, type does ' +
      'not allow attachments, or a card image of the wrong type/size',
  })
  @ApiResponse({ status: 403, description: 'Access denied to the secret or a storage object' })
  @ApiResponse({ status: 404, description: 'Secret or storage object not found' })
  @ApiResponse({ status: 409, description: 'Concurrent renewal conflicted on an attachment role' })
  async renew(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenewSecretDto,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.secretsService.renew(id, dto, user.id, user.permissions);
    return { data: result };
  }

  // ---------------------------------------------------------------------------
  // Attachments
  // ---------------------------------------------------------------------------

  @Post(':id/attachments')
  @Auth({ permissions: [PERMISSIONS.SECRETS_WRITE] })
  @ApiOperation({ summary: 'Link a storage object as an attachment to the secret' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Secret ID' })
  @ApiResponse({ status: 201, description: 'Attachment linked successfully' })
  @ApiResponse({ status: 400, description: 'Type does not allow attachments' })
  async linkAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkAttachmentDto,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.secretsService.linkAttachment(id, dto, user.id, user.permissions);
    return { data: result };
  }

  @Get(':id/attachments')
  @Auth({ permissions: [PERMISSIONS.SECRETS_READ] })
  @ApiOperation({
    summary: 'List attachments for a secret',
    description:
      'Defaults to the current version. Pass versionId to read a historical ' +
      "version's attachments, and/or role to filter to a single card side.",
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Secret ID' })
  @ApiQuery({ name: 'versionId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'role', required: false, enum: ['card_front', 'card_back'] })
  @ApiResponse({ status: 200, description: 'Attachment list' })
  @ApiResponse({ status: 404, description: 'Secret or version not found' })
  async findAttachments(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(attachmentListQuerySchema))
    query: AttachmentListQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    const attachments = await this.secretsService.findAttachments(
      id,
      user.id,
      user.permissions,
      query,
    );
    return { data: attachments };
  }

  @Delete(':id/attachments/:attachmentId')
  @Auth({ permissions: [PERMISSIONS.SECRETS_WRITE] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an attachment from a secret and delete the storage object' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Secret ID' })
  @ApiParam({ name: 'attachmentId', type: String, format: 'uuid', description: 'Attachment ID' })
  @ApiResponse({ status: 204, description: 'Attachment removed' })
  @ApiResponse({ status: 404, description: 'Attachment not found' })
  async unlinkAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    await this.secretsService.unlinkAttachment(
      id,
      attachmentId,
      user.id,
      user.permissions,
    );
  }
}
