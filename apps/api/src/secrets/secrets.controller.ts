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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/interfaces/authenticated-user.interface';
import { PERMISSIONS } from '../common/constants/roles.constants';

import { SecretsService } from './secrets.service';
import { CreateSecretDto } from './dto/create-secret.dto';
import { UpdateSecretDto } from './dto/update-secret.dto';
import {
  SecretListQueryDto,
  secretListQuerySchema,
} from './dto/secret-list-query.dto';
import { LinkAttachmentDto } from './dto/link-attachment.dto';

@ApiTags('Secrets')
@Controller('secrets')
export class SecretsController {
  constructor(private readonly secretsService: SecretsService) {}

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
  @ApiOperation({ summary: 'List all attachments for a secret' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Secret ID' })
  @ApiResponse({ status: 200, description: 'Attachment list' })
  async findAttachments(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    const secret = await this.secretsService.findOne(id, user.id, user.permissions);
    return { data: secret.attachments ?? [] };
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
