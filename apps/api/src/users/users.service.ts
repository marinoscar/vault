import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserListQueryDto } from './dto/user-list-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserRolesDto } from './dto/update-user-roles.dto';
import { ROLES } from '../common/constants/roles.constants';
import {
  DEFAULT_ORG_MEMBERSHIP_NAME_INCLUDE,
  DEFAULT_ORG_ACTIVE_MEMBERSHIP,
  membershipRoleNames,
  setUserRoles,
} from '../auth/membership-role-shim';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * List users with pagination and filtering
   */
  async listUsers(query: UserListQueryDto) {
    const { page, pageSize, search, role, isActive, sortBy, sortOrder } = query;
    const skip = (page - 1) * pageSize;

    // Build where clause
    const where: any = {};

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { displayName: { contains: search, mode: 'insensitive' } },
        { providerDisplayName: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (role) {
      // PLATFORM-ADOPTION-SHIM(E3.2): org roles live on the default-org membership.
      const roleFilter = [
        { userRoles: { some: { role: { name: role } } } },
        { memberships: { some: { ...DEFAULT_ORG_ACTIVE_MEMBERSHIP, role: { name: role } } } },
      ];
      where.AND = [...(where.AND ?? []), { OR: roleFilter }];
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    // Execute query
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
        include: {
          userRoles: {
            include: { role: true },
          },
          memberships: DEFAULT_ORG_MEMBERSHIP_NAME_INCLUDE,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    // Transform to response format
    const transformedItems = items.map((user) => ({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      providerDisplayName: user.providerDisplayName,
      profileImageUrl: user.profileImageUrl,
      providerProfileImageUrl: user.providerProfileImageUrl,
      isActive: user.isActive,
      roles: membershipRoleNames(user.userRoles, user.memberships),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }));

    return {
      items: transformedItems,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Get user by ID
   */
  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        userRoles: {
          include: { role: true },
        },
        memberships: DEFAULT_ORG_MEMBERSHIP_NAME_INCLUDE,
        identities: {
          select: {
            provider: true,
            providerEmail: true,
            createdAt: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      providerDisplayName: user.providerDisplayName,
      profileImageUrl: user.profileImageUrl,
      providerProfileImageUrl: user.providerProfileImageUrl,
      isActive: user.isActive,
      roles: membershipRoleNames(user.userRoles, user.memberships),
      identities: user.identities,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  /**
   * Update user (admin actions)
   */
  async updateUser(
    id: string,
    dto: UpdateUserDto,
    adminUserId: string,
  ) {
    // Prevent admin from deactivating themselves
    if (dto.isActive === false && id === adminUserId) {
      throw new ForbiddenException('Cannot deactivate your own account');
    }

    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        displayName: dto.displayName,
        isActive: dto.isActive,
      },
      include: {
        userRoles: {
          include: { role: true },
        },
        memberships: DEFAULT_ORG_MEMBERSHIP_NAME_INCLUDE,
      },
    });

    // Log audit event
    await this.createAuditEvent(adminUserId, 'user:update', 'user', id, {
      changes: dto,
    });

    this.logger.log(`User ${id} updated by admin ${adminUserId}`);

    return {
      id: updated.id,
      email: updated.email,
      displayName: updated.displayName,
      providerDisplayName: updated.providerDisplayName,
      profileImageUrl: updated.profileImageUrl,
      providerProfileImageUrl: updated.providerProfileImageUrl,
      isActive: updated.isActive,
      roles: membershipRoleNames(updated.userRoles, updated.memberships),
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * Update user roles
   */
  async updateUserRoles(
    id: string,
    dto: UpdateUserRolesDto,
    adminUserId: string,
  ) {
    // Prevent admin from removing their own admin role
    if (id === adminUserId && !dto.roleNames.includes(ROLES.ADMIN)) {
      throw new ForbiddenException('Cannot remove admin role from yourself');
    }

    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    // Validate all roles exist
    const roles = await this.prisma.role.findMany({
      where: { name: { in: dto.roleNames } },
    });

    if (roles.length !== dto.roleNames.length) {
      const foundNames = roles.map((r) => r.name);
      const invalid = dto.roleNames.filter((n) => !foundNames.includes(n));
      throw new BadRequestException(`Invalid roles: ${invalid.join(', ')}`);
    }

    // Replace all roles in a transaction
    await this.prisma.$transaction(async (tx) => {
      // PLATFORM-ADOPTION-SHIM(E3.2): admin goes to user_roles, the org role
      // (contributor / viewer) to the default-org membership (migration 0024).
      await setUserRoles(tx, id, dto.roleNames);
    });

    // Log audit event
    await this.createAuditEvent(adminUserId, 'user:roles_update', 'user', id, {
      newRoles: dto.roleNames,
    });

    this.logger.log(
      `User ${id} roles updated to [${dto.roleNames.join(', ')}] by admin ${adminUserId}`,
    );

    return this.getUserById(id);
  }

  /**
   * Create audit event
   */
  private async createAuditEvent(
    actorUserId: string,
    action: string,
    targetType: string,
    targetId: string,
    meta: Record<string, unknown>,
  ) {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId,
        action,
        targetType,
        targetId,
        meta: meta as any,
      },
    });
  }
}
