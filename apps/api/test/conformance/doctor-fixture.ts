// How Vault boots for the `doctor-read-only` suite: the full `AppModule` with the Prisma client,
// the system (bypass) client and the storage provider replaced by the suite's recording,
// write-refusing doubles. `PLATFORM_PRISMA` is bound `useExisting: PrismaService`, so overriding
// `PrismaService` covers every Prisma token except the separate system client
// (`PrismaSystemService`), which some platform checks read through `forSystem`.

import type { DoctorConformanceFixture } from '@marinoscar/platform-api/doctor/testing';
import { STORAGE_PROVIDER } from '@marinoscar/platform-api/storage';

import { PrismaService } from '../../src/prisma/prisma.service';
import { PrismaSystemService } from '../../src/prisma/prisma-system.service';
import { closeTestApp, createTestApp, type TestContext } from '../helpers/test-app.helper';

/** The one statement core's `forSystem` sends first: a transaction-local setting, not a data write. */
function isBypassSetConfig(strings: TemplateStringsArray | string): boolean {
  const text = typeof strings === 'string' ? strings : strings.join('?');
  return /^\s*SELECT\s+set_config\('app\.rls_bypass',\s*'on',\s*true\)\s*$/i.test(text);
}

/**
 * The system client over the suite's recording double. Only the bypass `set_config` is answered
 * here; every other statement, read or write, still reaches the recorder, so a check that writes
 * through the system client is still caught.
 */
function systemClientOver(recording: unknown) {
  const client = recording as Record<string, (...args: unknown[]) => unknown>;
  const transactionClient = new Proxy(client, {
    get(target, property, receiver) {
      if (property === '$executeRaw') {
        return (strings: TemplateStringsArray, ...values: unknown[]) =>
          isBypassSetConfig(strings) ? Promise.resolve(0) : target.$executeRaw(strings, ...values);
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return {
    forSystem: () => transactionClient,
    $connect: async () => undefined,
    $disconnect: async () => undefined,
    $transaction: async (work: (tx: unknown) => unknown) => work(transactionClient),
  };
}

export const doctorConformanceFixture: DoctorConformanceFixture = {
  createContext: (doubles) =>
    createTestApp({
      overrideProviders: [
        { provide: PrismaService, useValue: doubles.prisma.client },
        { provide: PrismaSystemService, useValue: systemClientOver(doubles.prisma.client) },
        { provide: STORAGE_PROVIDER, useValue: doubles.storage.provider },
      ],
    }),
  closeContext: (context) => closeTestApp(context as TestContext),
};
