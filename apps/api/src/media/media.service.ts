import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ObjectsService } from '../storage/objects/objects.service';
import { PERMISSIONS } from '../common/constants/roles.constants';

import { CreateFolderDto } from './dto/create-folder.dto';
import { UpdateFolderDto } from './dto/update-folder.dto';
import { RenameFileDto } from './dto/rename-file.dto';
import { LinkFileDto } from './dto/link-file.dto';
import { FolderListQueryDto } from './dto/folder-list-query.dto';
import { FileListQueryDto } from './dto/file-list-query.dto';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly objectsService: ObjectsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Fetch a folder by ID and check the caller has access.
   *
   * If the caller owns the folder, access is always granted.
   * If not the owner, the caller must have the `_any` variant of the
   * required permission.
   */
  private async checkFolderAccess(
    folderId: string,
    userId: string,
    permission: string,
    userPermissions: string[],
  ) {
    const folder = await this.prisma.mediaFolder.findUnique({
      where: { id: folderId },
    });

    if (!folder) {
      throw new NotFoundException('Folder not found');
    }

    if (folder.userId !== userId) {
      const anyPermission = permission.replace(/:([^:]+)$/, ':$1_any');
      if (!userPermissions.includes(anyPermission)) {
        throw new ForbiddenException('Access denied');
      }
    }

    return folder;
  }

  // ---------------------------------------------------------------------------
  // Folder methods
  // ---------------------------------------------------------------------------

  async createFolder(dto: CreateFolderDto, userId: string) {
    this.logger.log(`Creating media folder "${dto.name}" for user ${userId}`);

    const folder = await this.prisma.mediaFolder.create({
      data: {
        name: dto.name,
        userId,
      },
      include: {
        _count: { select: { files: true } },
      },
    });

    this.logger.log(`Media folder created: ${folder.id}`);
    return folder;
  }

  async listFolders(
    query: FolderListQueryDto,
    userId: string,
    userPermissions: string[],
  ) {
    const { page, pageSize, search, sortBy, sortOrder } = query;
    const canReadAny = userPermissions.includes(PERMISSIONS.MEDIA_READ_ANY);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      ...(canReadAny ? {} : { userId }),
      ...(search
        ? { name: { contains: search, mode: 'insensitive' as const } }
        : {}),
    };

    const skip = (page - 1) * pageSize;

    const [items, totalItems] = await Promise.all([
      this.prisma.mediaFolder.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: pageSize,
        include: {
          _count: { select: { files: true } },
        },
      }),
      this.prisma.mediaFolder.count({ where }),
    ]);

    const totalPages = Math.ceil(totalItems / pageSize);

    return {
      items,
      meta: {
        page,
        pageSize,
        totalItems,
        totalPages,
      },
    };
  }

  async getFolder(
    folderId: string,
    userId: string,
    userPermissions: string[],
  ) {
    await this.checkFolderAccess(
      folderId,
      userId,
      PERMISSIONS.MEDIA_READ,
      userPermissions,
    );

    const folder = await this.prisma.mediaFolder.findUnique({
      where: { id: folderId },
      include: {
        _count: { select: { files: true } },
      },
    });

    if (!folder) {
      throw new NotFoundException('Folder not found');
    }

    return folder;
  }

  async updateFolder(
    folderId: string,
    dto: UpdateFolderDto,
    userId: string,
    userPermissions: string[],
  ) {
    await this.checkFolderAccess(
      folderId,
      userId,
      PERMISSIONS.MEDIA_WRITE,
      userPermissions,
    );

    this.logger.log(`Renaming media folder ${folderId} to "${dto.name}"`);

    const folder = await this.prisma.mediaFolder.update({
      where: { id: folderId },
      data: { name: dto.name },
      include: {
        _count: { select: { files: true } },
      },
    });

    this.logger.log(`Media folder renamed: ${folderId}`);
    return folder;
  }

  async deleteFolder(
    folderId: string,
    userId: string,
    userPermissions: string[],
  ): Promise<void> {
    await this.checkFolderAccess(
      folderId,
      userId,
      PERMISSIONS.MEDIA_DELETE,
      userPermissions,
    );

    this.logger.log(`Deleting media folder ${folderId} and all its files`);

    // Fetch all storage objects in this folder
    const files = await this.prisma.storageObject.findMany({
      where: { mediaFolderId: folderId },
      select: { id: true },
    });

    // Delete each storage object (S3 + DB) via ObjectsService
    for (const file of files) {
      try {
        await this.objectsService.delete(file.id, userId);
      } catch (err) {
        // Log but continue — we want to clean up as many files as possible
        this.logger.warn(
          `Failed to delete storage object ${file.id} during folder deletion: ${err}`,
        );
      }
    }

    // Delete the folder itself
    await this.prisma.mediaFolder.delete({ where: { id: folderId } });

    this.logger.log(`Media folder deleted: ${folderId}`);
  }

  // ---------------------------------------------------------------------------
  // File methods
  // ---------------------------------------------------------------------------

  async listFiles(
    folderId: string,
    query: FileListQueryDto,
    userId: string,
    userPermissions: string[],
  ) {
    await this.checkFolderAccess(
      folderId,
      userId,
      PERMISSIONS.MEDIA_READ,
      userPermissions,
    );

    const { page, pageSize, search, sortBy, sortOrder, mimeTypePrefix } = query;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      mediaFolderId: folderId,
      ...(search
        ? { name: { contains: search, mode: 'insensitive' as const } }
        : {}),
      ...(mimeTypePrefix
        ? { mimeType: { startsWith: mimeTypePrefix } }
        : {}),
    };

    const skip = (page - 1) * pageSize;

    const [items, totalItems] = await Promise.all([
      this.prisma.storageObject.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: pageSize,
      }),
      this.prisma.storageObject.count({ where }),
    ]);

    const totalPages = Math.ceil(totalItems / pageSize);

    return {
      items: items.map((item) => ({
        ...item,
        size: item.size.toString(),
      })),
      meta: {
        page,
        pageSize,
        totalItems,
        totalPages,
      },
    };
  }

  async getFile(
    folderId: string,
    fileId: string,
    userId: string,
    userPermissions: string[],
  ) {
    await this.checkFolderAccess(
      folderId,
      userId,
      PERMISSIONS.MEDIA_READ,
      userPermissions,
    );

    const file = await this.prisma.storageObject.findUnique({
      where: { id: fileId },
    });

    if (!file || file.mediaFolderId !== folderId) {
      throw new NotFoundException('File not found in this folder');
    }

    // Update lastAccessedAt in metadata
    const existingMetadata = (file.metadata as Record<string, unknown>) || {};
    const updatedMetadata: Record<string, unknown> = {
      ...existingMetadata,
      lastAccessedAt: new Date().toISOString(),
    };

    const updated = await this.prisma.storageObject.update({
      where: { id: fileId },
      data: { metadata: updatedMetadata as Prisma.InputJsonValue },
    });

    return {
      ...updated,
      size: updated.size.toString(),
    };
  }

  async renameFile(
    folderId: string,
    fileId: string,
    dto: RenameFileDto,
    userId: string,
    userPermissions: string[],
  ) {
    await this.checkFolderAccess(
      folderId,
      userId,
      PERMISSIONS.MEDIA_WRITE,
      userPermissions,
    );

    const file = await this.prisma.storageObject.findUnique({
      where: { id: fileId },
    });

    if (!file || file.mediaFolderId !== folderId) {
      throw new NotFoundException('File not found in this folder');
    }

    this.logger.log(`Renaming file ${fileId} to "${dto.name}"`);

    const updated = await this.prisma.storageObject.update({
      where: { id: fileId },
      data: { name: dto.name },
    });

    return {
      ...updated,
      size: updated.size.toString(),
    };
  }

  async deleteFile(
    folderId: string,
    fileId: string,
    userId: string,
    userPermissions: string[],
  ): Promise<void> {
    await this.checkFolderAccess(
      folderId,
      userId,
      PERMISSIONS.MEDIA_DELETE,
      userPermissions,
    );

    const file = await this.prisma.storageObject.findUnique({
      where: { id: fileId },
    });

    if (!file || file.mediaFolderId !== folderId) {
      throw new NotFoundException('File not found in this folder');
    }

    this.logger.log(`Deleting file ${fileId} from folder ${folderId}`);

    await this.objectsService.delete(fileId, userId);

    this.logger.log(`File deleted: ${fileId}`);
  }

  async getFileDownloadUrl(
    folderId: string,
    fileId: string,
    userId: string,
    userPermissions: string[],
  ) {
    await this.checkFolderAccess(
      folderId,
      userId,
      PERMISSIONS.MEDIA_READ,
      userPermissions,
    );

    const file = await this.prisma.storageObject.findUnique({
      where: { id: fileId },
    });

    if (!file || file.mediaFolderId !== folderId) {
      throw new NotFoundException('File not found in this folder');
    }

    return this.objectsService.getDownloadUrl(fileId, userId);
  }

  async linkFileToFolder(
    folderId: string,
    dto: LinkFileDto,
    userId: string,
    userPermissions: string[],
  ) {
    await this.checkFolderAccess(
      folderId,
      userId,
      PERMISSIONS.MEDIA_WRITE,
      userPermissions,
    );

    // Verify storage object exists and is owned by the caller
    const storageObject = await this.prisma.storageObject.findUnique({
      where: { id: dto.storageObjectId },
    });

    if (!storageObject) {
      throw new NotFoundException('Storage object not found');
    }

    const canWriteAny = userPermissions.includes(PERMISSIONS.MEDIA_WRITE_ANY);
    if (storageObject.uploadedById !== userId && !canWriteAny) {
      throw new ForbiddenException(
        'You do not have access to this storage object',
      );
    }

    this.logger.log(
      `Linking storage object ${dto.storageObjectId} to folder ${folderId}`,
    );

    const updated = await this.prisma.storageObject.update({
      where: { id: dto.storageObjectId },
      data: { mediaFolderId: folderId },
    });

    return {
      ...updated,
      size: updated.size.toString(),
    };
  }
}
