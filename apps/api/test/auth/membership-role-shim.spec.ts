import {
  membershipRoleNames,
  orgRoleNameFor,
  setUserRoles,
  withMembershipRoles,
} from '../../src/auth/membership-role-shim';
import { toRequestUser } from '../../src/auth/interfaces/authenticated-user.interface';
import { createMockPrismaService } from '../mocks/prisma.mock';

/**
 * PLATFORM-ADOPTION-SHIM(E3.2). Platform migration 0024 deletes the org-role
 * rows of user_roles and puts the role on the default-org membership. These
 * tests pin that the legacy permission resolution still grants a contributor,
 * a viewer and an admin what they had before the migration.
 */
describe('membership-role-shim', () => {
  const perm = (name: string) => ({ permission: { id: `p-${name}`, name } });
  const viewerRole = {
    id: 'r-viewer',
    name: 'viewer',
    rolePermissions: [perm('secrets:read'), perm('storage:read')],
  };
  const contributorRole = {
    id: 'r-contributor',
    name: 'contributor',
    rolePermissions: [perm('secrets:read'), perm('secrets:write'), perm('storage:write')],
  };
  const orgAdminRole = {
    id: 'r-org-admin',
    name: 'org_admin',
    rolePermissions: [perm('storage:read'), perm('storage:write'), perm('user_settings:write')],
  };
  const adminRole = {
    id: 'r-admin',
    name: 'admin',
    rolePermissions: [perm('users:read'), perm('secrets:read_any')],
  };

  let prisma: ReturnType<typeof createMockPrismaService>;
  beforeEach(() => {
    prisma = createMockPrismaService();
  });

  describe('withMembershipRoles (what a request is authorised with)', () => {
    it('gives a contributor, whose user_roles row 0024 deleted, the membership role permissions', async () => {
      prisma.membership.findFirst.mockResolvedValue({ role: contributorRole } as any);
      const user = await withMembershipRoles(prisma, { id: 'u1', userRoles: [] });
      const request = toRequestUser({ ...(user as any), email: 'c@example.test', isActive: true });
      expect(request.roles).toEqual(['contributor']);
      expect(request.permissions.sort()).toEqual(['secrets:read', 'secrets:write', 'storage:write']);
    });

    it('queries only an ACTIVE membership of the DEFAULT organization', async () => {
      prisma.membership.findFirst.mockResolvedValue(null);
      await withMembershipRoles(prisma, { id: 'u1', userRoles: [] });
      expect(prisma.membership.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', status: 'active', org: { isDefault: true } },
        }),
      );
    });

    it('keeps an admin whole: admin from user_roles plus the org grants that moved to org_admin', async () => {
      prisma.membership.findFirst.mockResolvedValue({ role: orgAdminRole } as any);
      const user = await withMembershipRoles(prisma, {
        id: 'u2',
        userRoles: [{ role: adminRole }],
      });
      const request = toRequestUser({ ...(user as any), email: 'a@example.test', isActive: true });
      expect(request.permissions.sort()).toEqual(
        ['secrets:read_any', 'storage:read', 'storage:write', 'user_settings:write', 'users:read'].sort(),
      );
    });

    it('does not add a role twice and leaves a user without a membership unchanged', async () => {
      prisma.membership.findFirst.mockResolvedValueOnce({ role: viewerRole } as any);
      const legacy = { id: 'u3', userRoles: [{ role: viewerRole }] };
      expect((await withMembershipRoles(prisma, legacy)).userRoles).toHaveLength(1);

      prisma.membership.findFirst.mockResolvedValueOnce(null);
      const none = { id: 'u4', userRoles: [] };
      expect(await withMembershipRoles(prisma, none)).toBe(none);
    });
  });

  describe('membershipRoleNames (what admin screens list)', () => {
    it('lists user_roles and the membership role, hiding org_admin', () => {
      expect(
        membershipRoleNames([{ role: { name: 'admin' } }], [{ role: { name: 'org_admin' } }]),
      ).toEqual(['admin']);
      expect(membershipRoleNames([], [{ role: { name: 'contributor' } }])).toEqual(['contributor']);
      expect(membershipRoleNames(undefined, undefined)).toEqual([]);
    });
  });

  describe('orgRoleNameFor (the mapping 0024 applied to existing users)', () => {
    it('admin -> org_admin; otherwise the highest of contributor > viewer; none -> viewer', () => {
      expect(orgRoleNameFor(['admin', 'contributor'])).toBe('org_admin');
      expect(orgRoleNameFor(['contributor', 'viewer'])).toBe('contributor');
      expect(orgRoleNameFor(['viewer'])).toBe('viewer');
      expect(orgRoleNameFor([])).toBe('viewer');
    });
  });

  describe('setUserRoles (what role assignment writes)', () => {
    beforeEach(() => {
      prisma.organization.findFirst.mockResolvedValue({ id: 'org-default' } as any);
      prisma.userRole.deleteMany.mockResolvedValue({ count: 0 });
      prisma.userRole.createMany.mockResolvedValue({ count: 0 });
      prisma.membership.upsert.mockResolvedValue({} as any);
      prisma.role.findMany.mockImplementation((async (args: any) =>
        [adminRole].filter((r) => args.where.name.in.includes(r.name))) as any);
      prisma.role.findUnique.mockImplementation((async (args: any) =>
        ({ viewer: viewerRole, contributor: contributorRole, org_admin: orgAdminRole })[
          args.where.name as string
        ] ?? null) as any);
    });

    it('writes only admin to user_roles and the org role to the membership', async () => {
      await setUserRoles(prisma, 'u1', ['admin', 'contributor']);
      expect(prisma.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
      expect(prisma.userRole.createMany).toHaveBeenCalledWith({
        data: [{ userId: 'u1', roleId: 'r-admin' }],
      });
      expect(prisma.membership.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_userId: { orgId: 'org-default', userId: 'u1' } },
          update: { roleId: 'r-org-admin', status: 'active' },
        }),
      );
    });

    it('a contributor gets no user_roles row, only the membership', async () => {
      await setUserRoles(prisma, 'u2', ['contributor']);
      expect(prisma.userRole.createMany).not.toHaveBeenCalled();
      expect(prisma.membership.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { roleId: 'r-contributor', status: 'active' } }),
      );
    });

    it('refuses when the default organization is missing (migrations not applied)', async () => {
      prisma.organization.findFirst.mockResolvedValue(null);
      await expect(setUserRoles(prisma, 'u3', ['viewer'])).rejects.toThrow(/Default organization/);
    });
  });
});
