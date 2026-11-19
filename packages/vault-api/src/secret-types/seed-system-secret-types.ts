import { SYSTEM_SECRET_TYPES, type SystemSecretType } from '@marinoscar/vault-contract/secret-types';

import type { VaultPrismaClient } from '../ports';

/** What {@link seedVaultSystemSecretTypes} did. */
export interface VaultSystemSecretTypesSeedResult {
  created: number;
  updated: number;
}

/**
 * Creates or converges the built-in (`isSystem: true`) secret types: Credential, API Key, Card,
 * Token, Note, Document. Idempotent; a host runs it from its seed after `seedPlatform` (issue #194:
 * it lived only in Vault's own `prisma/seed.ts`, so a second host had no Credential type and the
 * agent API had nothing to serve).
 *
 * `SecretType.name` has NO unique index, so the update is an `updateMany` over `(name, isSystem)`:
 * every duplicate row converges instead of one arbitrary row. Fields are append-only (see
 * `SYSTEM_SECRET_TYPES`); this never removes one.
 *
 * @param prisma - the host's client (the ordinary application role is enough: `secret_types` has no row-level security).
 * @param types - the definitions; default `SYSTEM_SECRET_TYPES` of `@marinoscar/vault-contract/secret-types`.
 *
 * @stability experimental
 */
export async function seedVaultSystemSecretTypes(
  prisma: Pick<VaultPrismaClient, 'secretType'>,
  types: readonly SystemSecretType[] = SYSTEM_SECRET_TYPES,
): Promise<VaultSystemSecretTypesSeedResult> {
  const result: VaultSystemSecretTypesSeedResult = { created: 0, updated: 0 };
  for (const type of types) {
    const { name, ...rest } = type;
    const fields = rest.fields as never;
    const res = await prisma.secretType.updateMany({
      where: { name, isSystem: true },
      data: { description: rest.description, icon: rest.icon, fields, allowAttachments: rest.allowAttachments },
    });
    if (res.count === 0) {
      await prisma.secretType.create({ data: { ...type, fields, isSystem: true } });
      result.created += 1;
    } else {
      result.updated += 1;
    }
  }
  return result;
}
