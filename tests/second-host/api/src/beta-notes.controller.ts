import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@marinoscar/platform-api/identity';

import { PrismaService } from './prisma.service';

/**
 * Host Beta's one page of its own: notes, on its own table (`beta_notes`) and its own permissions.
 * It exists to show the host's routes, permissions and schema living next to the Vault packages'.
 */
@ApiTags('Beta notes')
@Controller('beta/notes')
export class BetaNotesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Auth({ permissions: ['beta_notes:read' as never] })
  @ApiOperation({ summary: 'List Host Beta notes' })
  async list() {
    return this.prisma.betaNote.findMany({ orderBy: { createdAt: 'asc' } });
  }

  @Post()
  @Auth({ permissions: ['beta_notes:write' as never] })
  @ApiOperation({ summary: 'Create a Host Beta note' })
  async create(@Body() body: { title?: unknown }) {
    return this.prisma.betaNote.create({ data: { title: String(body?.title ?? 'Untitled') } });
  }
}
