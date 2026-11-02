// =============================================================================
// Move the OpenAI key out of system_settings.ai (issue #80, E4.2)
// =============================================================================
//
// Until E4.2 the admin's OpenAI key lived INSIDE the `global` system_settings
// row (`ai.apiKey`: ciphertext, iv, authTag, last4, updatedAt), encrypted with
// VAULT_ENCRYPTION_KEY. It now lives in the platform credential store
// (`credentials`, purpose `ai`, name `openai`), encrypted with
// SECRETS_ENCRYPTION_KEY. This module is the one-time move, kept free of Nest
// and of the command line so the tests can drive it with fakes:
//
//   1. read the `global` row;
//   2. no `ai.apiKey` block            -> nothing to do (a rerun lands here);
//   3. decrypt it with VAULT_ENCRYPTION_KEY;
//   4. a credential already exists:
//        same key  -> only blank the old field (a half-finished earlier run);
//        other key -> refuse: the credential is newer than the legacy block and
//                     the operator must pick (clear the key in the admin UI);
//   5. store the credential, read it back and compare, THEN blank `ai.apiKey`.
//
// Order matters: the old field is blanked only after the new store has returned
// the same plaintext, so a failure at any step leaves the key readable from one
// place or the other. Dry run (the default) performs steps 1 to 4 and writes
// nothing.
//
// THE KEY IS NEVER OUTPUT. The report holds booleans, an outcome and the legacy
// `last4` mask the admin screen already shows; errors name a stage, never a
// value. A caller prints the report and nothing else.
// =============================================================================

import type { CredentialsService } from '@marinoscar/platform-api/credentials';

import {
  VAULT_AI_CREDENTIAL_LABEL,
  VAULT_AI_CREDENTIAL_NAME,
  VAULT_AI_CREDENTIAL_PURPOSE,
} from '../platform/credentials/credentials.config';
import type { CryptoService } from '../common/services/crypto.service';

const SETTINGS_KEY = 'global';

export const AI_KEY_MIGRATION_AUDIT_ACTION = 'ai.key.migrated';

export type AiKeyMigrationOutcome =
  /** No `ai.apiKey` block in the row: already migrated, or never configured. */
  | 'nothing-to-migrate'
  /** Dry run: an apply would store the credential and blank the old field. */
  | 'would-migrate'
  /** Apply: stored in the credential store, old field blanked. */
  | 'migrated'
  /** The credential already held this key; the old field was (or would be) blanked. */
  | 'would-blank-only'
  | 'blanked-only'
  /** A different credential already exists. Nothing was changed. */
  | 'conflict';

/** What a run did. Booleans and an outcome only; never key material. */
export interface AiKeyMigrationReport {
  apply: boolean;
  outcome: AiKeyMigrationOutcome;
  /** `system_settings.global` has an `ai.apiKey` block. */
  legacyKeyPresent: boolean;
  /** The legacy block decrypted with VAULT_ENCRYPTION_KEY (null: nothing to try). */
  legacyKeyDecryptable: boolean | null;
  /** The legacy mask (last 4 characters), as the admin screen shows it. */
  legacyLast4: string | null;
  /** The credential store holds a key at (`ai`, `openai`) after the run. */
  credentialPresent: boolean;
}

/** A failed stage. The message names the stage and never carries a value. */
export class AiKeyMigrationError extends Error {
  constructor(
    readonly stage:
      | 'decrypt-legacy'
      | 'store-credential'
      | 'verify-credential'
      | 'blank-legacy'
      | 'concurrent-write',
    message: string,
  ) {
    super(message);
    this.name = 'AiKeyMigrationError';
  }
}

/** The slice of the Prisma client the migration touches. */
export interface AiKeyMigrationPrisma {
  systemSettings: {
    findUnique(args: { where: { key: string } }): Promise<{
      id: string;
      value: unknown;
      version: number;
    } | null>;
    updateMany(args: {
      where: { key: string; version: number };
      data: { value: unknown; version: { increment: number } };
    }): Promise<{ count: number }>;
  };
  auditEvent: {
    create(args: {
      data: {
        action: string;
        targetType: string;
        targetId: string;
        meta: unknown;
      };
    }): Promise<unknown>;
  };
}

export interface AiKeyMigrationDeps {
  prisma: AiKeyMigrationPrisma;
  /** Decrypts the legacy block (VAULT_ENCRYPTION_KEY). */
  crypto: Pick<CryptoService, 'decrypt'>;
  credentials: Pick<CredentialsService, 'describe' | 'getSecret' | 'setSecret'>;
}

interface LegacyApiKeyBlock {
  ciphertext: string;
  iv: string;
  authTag: string;
  last4?: string;
}

function readLegacyBlock(value: unknown): LegacyApiKeyBlock | null {
  const ai = (value as { ai?: { apiKey?: unknown } } | null)?.ai;
  const block = ai?.apiKey as Partial<LegacyApiKeyBlock> | null | undefined;
  if (
    !block ||
    typeof block.ciphertext !== 'string' ||
    typeof block.iv !== 'string' ||
    typeof block.authTag !== 'string'
  ) {
    return null;
  }
  return block as LegacyApiKeyBlock;
}

export async function migrateAiKey(
  deps: AiKeyMigrationDeps,
  options: { apply: boolean },
): Promise<AiKeyMigrationReport> {
  const { prisma, crypto, credentials } = deps;
  const { apply } = options;

  const row = await prisma.systemSettings.findUnique({ where: { key: SETTINGS_KEY } });
  const legacy = row ? readLegacyBlock(row.value) : null;
  const existing = await credentials.describe(
    VAULT_AI_CREDENTIAL_PURPOSE,
    VAULT_AI_CREDENTIAL_NAME,
  );

  if (!row || !legacy) {
    return {
      apply,
      outcome: 'nothing-to-migrate',
      legacyKeyPresent: false,
      legacyKeyDecryptable: null,
      legacyLast4: null,
      credentialPresent: existing !== null,
    };
  }

  let plaintext: string;
  try {
    plaintext = crypto.decrypt(legacy.ciphertext, legacy.iv, legacy.authTag);
  } catch {
    // Name the stage only: the underlying message must not travel.
    throw new AiKeyMigrationError(
      'decrypt-legacy',
      'The stored key could not be decrypted with VAULT_ENCRYPTION_KEY. Nothing was changed.',
    );
  }

  const base = {
    apply,
    legacyKeyPresent: true,
    legacyKeyDecryptable: true,
    legacyLast4: typeof legacy.last4 === 'string' ? legacy.last4 : null,
  };

  let sameAsStored = false;
  if (existing) {
    const stored = await credentials.getSecret(
      VAULT_AI_CREDENTIAL_PURPOSE,
      VAULT_AI_CREDENTIAL_NAME,
    );
    sameAsStored = stored === plaintext;
    if (!sameAsStored) {
      return { ...base, outcome: 'conflict', credentialPresent: true };
    }
  }

  if (!apply) {
    return {
      ...base,
      outcome: sameAsStored ? 'would-blank-only' : 'would-migrate',
      credentialPresent: existing !== null,
    };
  }

  if (!sameAsStored) {
    try {
      await credentials.setSecret(
        VAULT_AI_CREDENTIAL_PURPOSE,
        VAULT_AI_CREDENTIAL_NAME,
        plaintext,
        { label: VAULT_AI_CREDENTIAL_LABEL },
      );
    } catch {
      throw new AiKeyMigrationError(
        'store-credential',
        'The credential store refused the key (is SECRETS_ENCRYPTION_KEY set and valid?). Nothing was changed.',
      );
    }

    const readBack = await credentials.getSecret(
      VAULT_AI_CREDENTIAL_PURPOSE,
      VAULT_AI_CREDENTIAL_NAME,
    );
    if (readBack !== plaintext) {
      throw new AiKeyMigrationError(
        'verify-credential',
        'The stored credential did not read back as the same key. The old field was NOT blanked.',
      );
    }
  }

  // Blank the old field. `updateMany` on the version read above, so a concurrent
  // admin save between the read and here is detected instead of overwritten.
  const value = row.value as { ai: Record<string, unknown> } & Record<string, unknown>;
  const next = { ...value, ai: { ...value.ai, apiKey: null } };
  let updated: { count: number };
  try {
    updated = await prisma.systemSettings.updateMany({
      where: { key: SETTINGS_KEY, version: row.version },
      data: { value: next, version: { increment: 1 } },
    });
  } catch {
    throw new AiKeyMigrationError(
      'blank-legacy',
      'The old field could not be blanked. The credential is stored; rerun to finish.',
    );
  }
  if (updated.count !== 1) {
    throw new AiKeyMigrationError(
      'concurrent-write',
      'The settings row changed while migrating. The credential is stored; rerun to finish.',
    );
  }

  await prisma.auditEvent.create({
    data: {
      action: AI_KEY_MIGRATION_AUDIT_ACTION,
      targetType: 'credential',
      targetId: `${VAULT_AI_CREDENTIAL_PURPOSE}/${VAULT_AI_CREDENTIAL_NAME}`,
      // No key, no mask: the fact of the move is all the audit row needs.
      meta: { from: 'system_settings.ai.apiKey', to: 'credentials' },
    },
  });

  return {
    ...base,
    outcome: sameAsStored ? 'blanked-only' : 'migrated',
    credentialPresent: true,
  };
}

/** One printable line per fact; counts and booleans only. */
export function formatAiKeyMigrationReport(report: AiKeyMigrationReport): string[] {
  const lines = [
    `mode: ${report.apply ? 'APPLY' : 'dry run (pass --apply to change anything)'}`,
    `legacy key in system_settings.ai: ${report.legacyKeyPresent ? 'present' : 'absent'}`,
  ];
  if (report.legacyKeyPresent) {
    lines.push(
      `legacy key decrypts with VAULT_ENCRYPTION_KEY: ${report.legacyKeyDecryptable ? 'yes' : 'no'}`,
    );
    if (report.legacyLast4) lines.push(`legacy key mask: ••••${report.legacyLast4}`);
  }
  lines.push(
    `credential ${VAULT_AI_CREDENTIAL_PURPOSE}/${VAULT_AI_CREDENTIAL_NAME}: ${report.credentialPresent ? 'present' : 'absent'}`,
    `outcome: ${report.outcome}`,
  );
  return lines;
}
