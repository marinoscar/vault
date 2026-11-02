import { DeepMockProxy, mockDeep, mockReset } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

/**
 * Type-safe Prisma mock for testing
 */
export type MockPrismaClient = DeepMockProxy<PrismaClient>;
export type MockPrismaService = DeepMockProxy<PrismaClient>;

/**
 * Global Prisma mock instance
 * Use this in tests with jest-mock-extended
 */
const _prismaMock: MockPrismaClient = mockDeep<PrismaClient>();

// Export as `any` to allow flexible mocking without strict Prisma type checking
// This is intentional - tests need to mock partial responses
export const prismaMock = _prismaMock as any;

/**
 * Alias for backward compatibility
 */
export const mockPrisma = prismaMock;

/**
 * Reset all Prisma mocks
 * Call this in beforeEach() to ensure clean state
 */
export function resetPrismaMock(): void {
  mockReset(prismaMock);
  installPlatformAdoptionDefaults(prismaMock);
}

/**
 * Defaults for the two PLATFORM-ADOPTION-SHIMs every request-level test passes
 * through (docs/platform-adoption/local-exceptions.md):
 *  - the default organization exists (storage objects are written with its id,
 *    org roles are assigned on its membership);
 *  - role assignment: `admin` stays in user_roles, org roles go on the
 *    membership (src/auth/membership-role-shim.ts).
 * Tests that care override these after calling resetPrismaMock().
 */
export function installPlatformAdoptionDefaults(mock: any): void {
  mock.organization.findFirst.mockResolvedValue({ id: 'org-default' });
  mock.membership.findFirst.mockResolvedValue(null);
  mock.membership.upsert.mockResolvedValue({});
  mock.userRole.createMany.mockResolvedValue({ count: 0 });
  mock.role.findMany.mockImplementation(async (args: any) =>
    ((args?.where?.name?.in as string[]) ?? []).map((name) => ({ id: `role-${name}`, name })),
  );
}

/**
 * Helper to mock $transaction - executes callbacks immediately
 */
export function mockPrismaTransaction(): void {
  prismaMock.$transaction.mockImplementation(async (arg: any) => {
    if (typeof arg === 'function') {
      // Interactive transaction
      return arg(prismaMock);
    } else if (Array.isArray(arg)) {
      // Sequential operations
      return Promise.all(arg);
    }
    return arg;
  });
}

/**
 * Creates a fresh mock PrismaService for unit tests
 */
export function createMockPrismaService(): MockPrismaService {
  return mockDeep<PrismaClient>();
}
