/**
 * The two things the default-organization RLS scope (`runInDefaultOrg`,
 * src/core/default-org.ts) needs from a hand-rolled Prisma mock: the default
 * organization row and `$executeRaw` (the `set_config` statement).
 *
 * PLATFORM-ADOPTION-SHIM(multi-org)
 */
export const DEFAULT_ORG_ID = '00000000-0000-4000-8000-0000000000d0';

export function defaultOrgMock() {
  return {
    organization: { findFirst: jest.fn().mockResolvedValue({ id: DEFAULT_ORG_ID }) },
    $executeRaw: jest.fn().mockResolvedValue(0),
  };
}
