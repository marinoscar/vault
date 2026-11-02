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
 * A fresh transaction client over the mock. Prisma hands a NEW client to every
 * interactive transaction; the platform's `runInOrg` remembers the scope of the
 * client it handed out (a WeakMap), so a mock that passes the SAME object to
 * every callback would make the second `runInOrg` look nested and skip its
 * `$transaction`. A prototype child shares every mocked method with the mock.
 */
export function freshTransactionClient(mock: any): any {
  return Object.create(mock);
}

/**
 * Defaults every request-level test passes through:
 *  - the default organization exists (storage objects are written with its id
 *    inside `runInDefaultOrg`; src/prisma/default-org.ts);
 *  - interactive transactions run their callback on a fresh client over the mock.
 * Tests that care override these after calling resetPrismaMock().
 */
export function installPlatformAdoptionDefaults(mock: any): void {
  // Storage access runs in `runInDefaultOrg` (an interactive $transaction whose
  // first statement is set_config); a unit test runs the callback on the mock.
  mock.$transaction.mockImplementation(async (arg: any) =>
    typeof arg === 'function' ? arg(freshTransactionClient(mock)) : Array.isArray(arg) ? Promise.all(arg) : arg,
  );
  mock.organization.findFirst.mockResolvedValue({ id: '00000000-0000-4000-8000-0000000000d0' });
}

/**
 * Helper to mock $transaction - executes callbacks immediately
 */
export function mockPrismaTransaction(): void {
  prismaMock.$transaction.mockImplementation(async (arg: any) => {
    if (typeof arg === 'function') {
      // Interactive transaction
      return arg(freshTransactionClient(prismaMock));
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
  const mock = mockDeep<PrismaClient>();
  installPlatformAdoptionDefaults(mock);
  return mock;
}
