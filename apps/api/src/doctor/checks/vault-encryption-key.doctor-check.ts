import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  DoctorCheckRegistry,
  type DoctorCheck,
  type DoctorCheckOutcome,
} from '@marinoscar/platform-api/doctor';

import { CryptoService } from '../../common/services/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';

// =============================================================================
// Doctor check: VAULT_ENCRYPTION_KEY (issue #76, epic #54)
// =============================================================================
//
// Every secret value is AES-256-GCM ciphertext under VAULT_ENCRYPTION_KEY, and
// `CryptoService.onModuleInit` only WARNS when it is missing. This check proves
// the running process can use it:
//
//   1. a canary is encrypted and decrypted in memory (the key is present and the
//      cipher works), and
//   2. one stored `secret_versions` row, when there is one, is decrypted and the
//      result discarded (the key is the SAME key the data was written with, so a
//      rotated or replaced key fails here before it fails a user).
//
// READ-ONLY: one `SELECT` of a single ciphertext row, no write of any kind. The
// plaintext of the stored row is never inspected, returned, logged or put in
// `data`; only the verdict is reported.
// =============================================================================

export const ENCRYPTION_KEY_CHECK_ID = 'vault.encryption_key';

const CANARY = 'vault-doctor-canary';

export interface EncryptionKeyProbe {
  /** True when the in-memory encrypt/decrypt of the canary returned the canary. */
  canaryRoundTrip: boolean;
  /** `null`: no stored version to try. `true`/`false`: it did / did not decrypt. */
  storedVersionDecrypts: boolean | null;
}

/** The rule, separated from the probing so a test can drive it without a key or a database. */
export function decideEncryptionKey(probe: EncryptionKeyProbe | { keyUnavailable: true }): DoctorCheckOutcome {
  if ('keyUnavailable' in probe) {
    return {
      status: 'fail',
      detail: 'VAULT_ENCRYPTION_KEY is not usable: secrets, backups and the AI key cannot be encrypted or read',
      remedy: 'Set VAULT_ENCRYPTION_KEY to the 64-hex-character key the data was encrypted with, then restart the API',
      data: { canaryRoundTrip: false, storedVersionChecked: false },
    };
  }

  if (!probe.canaryRoundTrip) {
    return {
      status: 'fail',
      detail: 'The encryption key loaded but a test value did not survive an encrypt and decrypt round trip',
      remedy: 'Check that VAULT_ENCRYPTION_KEY is exactly 64 hex characters and restart the API',
      data: { canaryRoundTrip: false, storedVersionChecked: false },
    };
  }

  if (probe.storedVersionDecrypts === false) {
    return {
      status: 'fail',
      detail:
        'VAULT_ENCRYPTION_KEY works, but it cannot decrypt a stored secret version: it is not the key the data was written with',
      remedy:
        'Restore the original VAULT_ENCRYPTION_KEY. Never rotate it without a rehearsed migration on a restored copy (docs/SECRETS.md)',
      data: { canaryRoundTrip: true, storedVersionChecked: true },
    };
  }

  return {
    status: 'pass',
    detail:
      probe.storedVersionDecrypts === true
        ? 'Encryption key is configured and decrypts the stored secrets'
        : 'Encryption key is configured (no stored secret to verify it against yet)',
    data: { canaryRoundTrip: true, storedVersionChecked: probe.storedVersionDecrypts === true },
  };
}

@Injectable()
export class VaultEncryptionKeyDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = ENCRYPTION_KEY_CHECK_ID;
  readonly category = 'core';
  readonly label = 'Vault encryption key';
  readonly dependsOn = ['db.connection'] as const;

  constructor(
    private readonly registry: DoctorCheckRegistry,
    private readonly crypto: CryptoService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    let canaryRoundTrip = false;
    try {
      const sealed = this.crypto.encrypt(CANARY);
      canaryRoundTrip = this.crypto.decrypt(sealed.ciphertext, sealed.iv, sealed.authTag) === CANARY;
    } catch {
      return decideEncryptionKey({ keyUnavailable: true });
    }

    let storedVersionDecrypts: boolean | null = null;
    if (canaryRoundTrip) {
      const row = await this.prisma.secretVersion.findFirst({
        where: { isCurrent: true },
        select: { encryptedData: true, iv: true, authTag: true },
      });
      if (row) {
        try {
          this.crypto.decrypt(row.encryptedData, row.iv, row.authTag);
          storedVersionDecrypts = true;
        } catch {
          storedVersionDecrypts = false;
        }
      }
    }

    return decideEncryptionKey({ canaryRoundTrip, storedVersionDecrypts });
  }
}
