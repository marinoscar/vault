import {
  Controller,
  Get,
  Post,
  Patch,
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

import { MediaService } from './media.service';
import { CreateFolderDto } from './dto/create-folder.dto';
import { UpdateFolderDto } from './dto/update-folder.dto';
import { RenameFileDto } from './dto/rename-file.dto';
import { LinkFileDto } from './dto/link-file.dto';
import {
  FolderListQueryDto,
  folderListQuerySchema,
} from './dto/folder-list-query.dto';
import {
  FileListQueryDto,
  fileListQuerySchema,
} from './dto/file-list-query.dto';

@ApiTags('Media')
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  // ---------------------------------------------------------------------------
  // Folder endpoints
  // ---------------------------------------------------------------------------

  @Post('folders')
  @Auth({ permissions: [PERMISSIONS.MEDIA_WRITE] })
  @ApiOperation({ summary: 'Create a new media folder' })
  @ApiResponse({ status: 201, description: 'Folder created successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async createFolder(
    @Body() dto: CreateFolderDto,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.mediaService.createFolder(dto, user.id);
    return { data: result };
  }

  @Get('folders')
  @Auth({ permissions: [PERMISSIONS.MEDIA_READ] })
  @ApiOperation({ summary: 'List media folders (paginated)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['createdAt', 'name', 'updatedAt'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiResponse({ status: 200, description: 'Paginated list of folders' })
  async listFolders(
    @Query(new ZodValidationPipe(folderListQuerySchema)) query: FolderListQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.mediaService.listFolders(
      query,
      user.id,
      user.permissions,
    );
    return { data: result };
  }

  @Get('folders/:folderId')
  @Auth({ permissions: [PERMISSIONS.MEDIA_READ] })
  @ApiOperation({ summary: 'Get media folder detail' })
  @ApiParam({ name: 'folderId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Folder detail' })
  @ApiResponse({ status: 404, description: 'Folder not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async getFolder(
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.mediaService.getFolder(
      folderId,
      user.id,
      user.permissions,
    );
    return { data: result };
  }

  @Patch('folders/:folderId')
  @Auth({ permissions: [PERMISSIONS.MEDIA_WRITE] })
  @ApiOperation({ summary: 'Rename a media folder' })
  @ApiParam({ name: 'folderId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Folder renamed successfully' })
  @ApiResponse({ status: 404, description: 'Folder not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async updateFolder(
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @Body() dto: UpdateFolderDto,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.mediaService.updateFolder(
      folderId,
      dto,
      user.id,
      user.permissions,
    );
    return { data: result };
  }

  @Delete('folders/:folderId')
  @Auth({ permissions: [PERMISSIONS.MEDIA_DELETE] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a media folder and all its files' })
  @ApiParam({ name: 'folderId', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Folder deleted successfully' })
  @ApiResponse({ status: 404, description: 'Folder not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async deleteFolder(
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    await this.mediaService.deleteFolder(folderId, user.id, user.permissions);
  }

  // ---------------------------------------------------------------------------
  // File endpoints
  // ---------------------------------------------------------------------------

  @Get('folders/:folderId/files')
  @Auth({ permissions: [PERMISSIONS.MEDIA_READ] })
  @ApiOperation({ summary: 'List files in a media folder (paginated)' })
  @ApiParam({ name: 'folderId', type: String, format: 'uuid' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['createdAt', 'name', 'updatedAt'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'mimeTypePrefix', required: false, type: String, description: 'Filter by MIME type prefix (e.g. "video/", "audio/", "image/")' })
  @ApiResponse({ status: 200, description: 'Paginated list of files' })
  @ApiResponse({ status: 404, description: 'Folder not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async listFiles(
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @Query(new ZodValidationPipe(fileListQuerySchema)) query: FileListQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.mediaService.listFiles(
      folderId,
      query,
      user.id,
      user.permissions,
    );
    return { data: result };
  }

  @Post('folders/:folderId/files')
  @Auth({ permissions: [PERMISSIONS.MEDIA_WRITE] })
  @ApiOperation({ summary: 'Link a storage object to a media folder' })
  @ApiParam({ name: 'folderId', type: String, format: 'uuid' })
  @ApiResponse({ status: 201, description: 'File linked to folder successfully' })
  @ApiResponse({ status: 404, description: 'Folder or storage object not found' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async linkFileToFolder(
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @Body() dto: LinkFileDto,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.mediaService.linkFileToFolder(
      folderId,
      dto,
      user.id,
      user.permissions,
    );
    return { data: result };
  }

  @Get('folders/:folderId/files/:fileId')
  @Auth({ permissions: [PERMISSIONS.MEDIA_READ] })
  @ApiOperation({ summary: 'Get file detail and update last accessed timestamp' })
  @ApiParam({ name: 'folderId', type: String, format: 'uuid' })
  @ApiParam({ name: 'fileId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'File detail' })
  @ApiResponse({ status: 404, description: 'File not found in folder' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async getFile(
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.mediaService.getFile(
      folderId,
      fileId,
      user.id,
      user.permissions,
    );
    return { data: result };
  }

  @Patch('folders/:folderId/files/:fileId')
  @Auth({ permissions: [PERMISSIONS.MEDIA_WRITE] })
  @ApiOperation({ summary: 'Rename a file in a media folder' })
  @ApiParam({ name: 'folderId', type: String, format: 'uuid' })
  @ApiParam({ name: 'fileId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'File renamed successfully' })
  @ApiResponse({ status: 404, description: 'File not found in folder' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async renameFile(
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body() dto: RenameFileDto,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.mediaService.renameFile(
      folderId,
      fileId,
      dto,
      user.id,
      user.permissions,
    );
    return { data: result };
  }

  @Delete('folders/:folderId/files/:fileId')
  @Auth({ permissions: [PERMISSIONS.MEDIA_DELETE] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a file from a media folder' })
  @ApiParam({ name: 'folderId', type: String, format: 'uuid' })
  @ApiParam({ name: 'fileId', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'File deleted successfully' })
  @ApiResponse({ status: 404, description: 'File not found in folder' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async deleteFile(
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    await this.mediaService.deleteFile(
      folderId,
      fileId,
      user.id,
      user.permissions,
    );
  }

  @Get('folders/:folderId/files/:fileId/download')
  @Auth({ permissions: [PERMISSIONS.MEDIA_READ] })
  @ApiOperation({ summary: 'Get signed download URL for a file' })
  @ApiParam({ name: 'folderId', type: String, format: 'uuid' })
  @ApiParam({ name: 'fileId', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Signed download URL' })
  @ApiResponse({ status: 404, description: 'File not found in folder' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async getFileDownloadUrl(
    @Param('folderId', ParseUUIDPipe) folderId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.mediaService.getFileDownloadUrl(
      folderId,
      fileId,
      user.id,
      user.permissions,
    );
    return { data: result };
  }
}
