/**
 * PLATFORM-ADOPTION-SHIM(E3.2)
 *
 * Platform migration 0024_split_system_org_roles moves the org roles
 * (contributor, viewer, and the new org_admin) off `user_roles` and onto the
 * default organization's membership (`memberships.role_id`), and moves the
 * org-scoped grants of `admin` (storage:*, user_settings:*) to `org_admin`.
 * Only `admin` stays in `user_roles`.
 *
 * Vault's legacy auth still resolves permissions from `user_roles` alone, so
 * without this module every contributor and viewer would lose every
 * permission the moment the migration is applied. This module keeps the legacy
 * code correct until the platform identity slice replaces it (E3.2):
 *
 *   READ   effective roles = `user_roles` + the role of the user's active
 *          membership of the default organization
 *          ({@link withMembershipRoles}, {@link membershipRoleNames}).
 *   WRITE  assigning roles writes `admin` to `user_roles` and everything else
 *          to the membership ({@link setUserRoles}), the same mapping 0024
 *          applied to existing users (admin -> org_admin; otherwise the
 *          highest of contributor > viewer; none -> viewer).
 *
 * Delete this file with the legacy AuthService in E3.2; it is listed in
 * docs/platform-adoption/local-exceptions.md.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

import { ROLES } from '../common/constants/roles.constants';

/** Roles that remain global assignments in `user_roles` after 0024. */
export const SYSTEM_ROLE_NAMES: readonly string[] = [ROLES.ADMIN];

/** The role 0024 creates for the organization administrator. */
export const ORG_ADMIN_ROLE = 'org_admin';

type MembershipDb = Pick<PrismaClient, 'membership'>;
type AssignDb = Pick<PrismaClient, 'membership' | 'organization' | 'role' | 'userRole'>;

/** Role with its permissions, the shape `AuthenticatedUser.userRoles[].role` has. */
const ROLE_WITH_PERMISSIONS = {
  include: { rolePermissions: { include: { permission: true } } },
} satisfies Prisma.RoleDefaultArgs;

/** Where-clause for "the active membership of the default organization". */
export const DEFAULT_ORG_ACTIVE_MEMBERSHIP = {
  status: 'active',
  org: { isDefault: true },
} satisfies Prisma.MembershipWhereInput;

/**
 * `include` fragment that loads the default-org membership role next to a
 * user, for queries that only need role NAMES (admin listings).
 */
export const DEFAULT_ORG_MEMBERSHIP_NAME_INCLUDE = {
  where: DEFAULT_ORG_ACTIVE_MEMBERSHIP,
  select: { role: { select: { name: true } } },
} as const;

/**
 * Returns `user` with the default-org membership role appended to `userRoles`
 * (with its permissions, so permission aggregation works unchanged). A role
 * the user already holds through `user_roles` is not added twice. A user with
 * no membership is returned as is.
 */
export async function withMembershipRoles<
  U extends { id: string; userRoles: Array<{ role: { id?: string; name: string } }> },
>(db: MembershipDb, user: U): Promise<U> {
  const membership = await db.membership.findFirst({
    where: { userId: user.id, ...DEFAULT_ORG_ACTIVE_MEMBERSHIP },
    include: { role: ROLE_WITH_PERMISSIONS },
  });
  if (!membership) return user;
  if (user.userRoles.some((ur) => ur.role.name === membership.role.name)) return user;
  return {
    ...user,
    userRoles: [...user.userRoles, { role: membership.role }],
  } as U;
}

/**
 * The role names a legacy admin screen shows for a user: `user_roles` names
 * plus the membership role's name. `org_admin` is left out because it is
 * implied by `admin` (0024 gave every admin an org_admin membership) and the
 * legacy UI has never known the name.
 */
export function membershipRoleNames(
  userRoles: Array<{ role: { name: string } | null }> | undefined,
  memberships: Array<{ role: { name: string } | null }> | undefined,
): string[] {
  const names = new Set<string>();
  for (const ur of userRoles ?? []) if (ur.role) names.add(ur.role.name);
  for (const m of memberships ?? []) {
    if (m.role && m.role.name !== ORG_ADMIN_ROLE) names.add(m.role.name);
  }
  return [...names];
}

/** The org role a set of legacy role names maps to (0024 step 4). */
export function orgRoleNameFor(roleNames: readonly string[]): string {
  if (roleNames.includes(ROLES.ADMIN)) return ORG_ADMIN_ROLE;
  if (roleNames.includes(ROLES.CONTRIBUTOR)) return ROLES.CONTRIBUTOR;
  return ROLES.VIEWER;
}

/**
 * Sets a user's legacy roles the way 0024 stores them: system roles in
 * `user_roles` (replacing every previous row, including leftovers for org
 * roles), the org role on the default organization's membership (created when
 * missing). Run it inside the caller's transaction by passing the `tx` client.
 */
export async function setUserRoles(
  db: AssignDb,
  userId: string,
  roleNames: readonly string[],
): Promise<void> {
  const systemRoles = await db.role.findMany({
    where: { name: { in: roleNames.filter((n) => SYSTEM_ROLE_NAMES.includes(n)) } },
    select: { id: true },
  });

  await db.userRole.deleteMany({ where: { userId } });
  if (systemRoles.length > 0) {
    await db.userRole.createMany({
      data: systemRoles.map((r) => ({ userId, roleId: r.id })),
    });
  }

  await setMembershipRole(db, userId, orgRoleNameFor(roleNames));
}

/**
 * Upserts the user's membership of the default organization with the named
 * org role. Throws when the default organization or the role is missing
 * (migrations or seed not run), the same failure class as a missing role.
 */
export async function setMembershipRole(
  db: Pick<AssignDb, 'membership' | 'organization' | 'role'>,
  userId: string,
  orgRoleName: string,
): Promise<void> {
  const [org, role] = await Promise.all([
    db.organization.findFirst({ where: { isDefault: true }, select: { id: true } }),
    db.role.findUnique({ where: { name: orgRoleName }, select: { id: true } }),
  ]);
  if (!org) {
    throw new Error('Default organization not found - apply the platform migrations');
  }
  if (!role) {
    throw new Error(`Role "${orgRoleName}" not found - run npm run prisma:seed`);
  }
  await db.membership.upsert({
    where: { orgId_userId: { orgId: org.id, userId } },
    update: { roleId: role.id, status: 'active' },
    create: { orgId: org.id, userId, roleId: role.id, status: 'active' },
  });
}
