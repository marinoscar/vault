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
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/interfaces/authenticated-user.interface';
import { PERMISSIONS } from '../common/constants/roles.constants';
import { SecretTypesService } from './secret-types.service';
import {
  CreateSecretTypeDto,
} from './dto/create-secret-type.dto';
import {
  UpdateSecretTypeDto,
} from './dto/update-secret-type.dto';
import {
  SecretTypeQueryDto,
  secretTypeQuerySchema,
} from './dto/secret-type-query.dto';

@ApiTags('Secret Types')
@Controller('secret-types')
export class SecretTypesController {
  constructor(private readonly secretTypesService: SecretTypesService) {}

  /**
   * Create a custom secret type
   */
  @Post()
  @Auth({ permissions: [PERMISSIONS.SECRET_TYPES_WRITE] })
  @ApiOperation({ summary: 'Create a custom secret type' })
  @ApiResponse({ status: 201, description: 'Secret type created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async create(
    @Body() dto: CreateSecretTypeDto,
    @CurrentUser('id') userId: string,
  ) {
    const result = await this.secretTypesService.create(dto, userId);
    return { data: result };
  }

  /**
   * List secret types
   */
  @Get()
  @Auth({ permissions: [PERMISSIONS.SECRET_TYPES_READ] })
  @ApiOperation({
    summary: 'List secret types',
    description:
      'Returns system types plus the current user\'s custom types. Admins with secret_types:read_any see all types.',
  })
  @ApiResponse({ status: 200, description: 'List retrieved successfully' })
  async findAll(
    @Query(new ZodValidationPipe(secretTypeQuerySchema)) query: SecretTypeQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    // Admins (or anyone with read_any) see all types; others only see their own + system
    const hasReadAny = user.permissions.includes('secret_types:read_any');
    const result = await this.secretTypesService.findAll(query, user.id, hasReadAny);
    return { data: result };
  }

  /**
   * Get a secret type by ID
   */
  @Get(':id')
  @Auth({ permissions: [PERMISSIONS.SECRET_TYPES_READ] })
  @ApiOperation({ summary: 'Get secret type by ID' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Secret type ID' })
  @ApiResponse({ status: 200, description: 'Secret type retrieved' })
  @ApiResponse({ status: 404, description: 'Secret type not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const result = await this.secretTypesService.findOne(id);
    return { data: result };
  }

  /**
   * Update a custom secret type
   */
  @Put(':id')
  @Auth({ permissions: [PERMISSIONS.SECRET_TYPES_WRITE] })
  @ApiOperation({ summary: 'Update a custom secret type' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Secret type ID' })
  @ApiResponse({ status: 200, description: 'Secret type updated' })
  @ApiResponse({ status: 400, description: 'Cannot modify system types or validation error' })
  @ApiResponse({ status: 403, description: 'Not the owner of this secret type' })
  @ApiResponse({ status: 404, description: 'Secret type not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSecretTypeDto,
    @CurrentUser('id') userId: string,
  ) {
    const result = await this.secretTypesService.update(id, dto, userId);
    return { data: result };
  }

  /**
   * Delete a custom secret type
   */
  @Delete(':id')
  @Auth({ permissions: [PERMISSIONS.SECRET_TYPES_DELETE] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a custom secret type' })
  @ApiParam({ name: 'id', type: String, format: 'uuid', description: 'Secret type ID' })
  @ApiResponse({ status: 204, description: 'Secret type deleted' })
  @ApiResponse({ status: 400, description: 'Cannot delete system types' })
  @ApiResponse({ status: 403, description: 'Not the owner of this secret type' })
  @ApiResponse({ status: 404, description: 'Secret type not found' })
  @ApiResponse({ status: 409, description: 'Cannot delete type that has secrets' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    await this.secretTypesService.remove(id, userId);
  }
}
