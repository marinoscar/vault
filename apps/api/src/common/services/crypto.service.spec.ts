import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  let service: CryptoService;

  // 64 hex characters = 32 bytes, valid AES-256-GCM key
  const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  function buildModule(encryptionKey: string | undefined): Promise<TestingModule> {
    return Test.createTestingModule({
      providers: [
        CryptoService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'vault.encryptionKey' ? encryptionKey : undefined,
          },
        },
      ],
    }).compile();
  }

  beforeEach(async () => {
    const module = await buildModule(TEST_KEY);
    service = module.get<CryptoService>(CryptoService);
    service.onModuleInit();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // onModuleInit
  // ============================================================================

  describe('onModuleInit', () => {
    it('should not throw when a valid 32-byte key is configured', async () => {
      const module = await buildModule(TEST_KEY);
      const svc = module.get<CryptoService>(CryptoService);
      expect(() => svc.onModuleInit()).not.toThrow();
    });

    it('should throw when the hex key decodes to a length other than 32 bytes', async () => {
      // 62 hex chars = 31 bytes, one byte short
      const shortKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd';
      const module = await buildModule(shortKey);
      const svc = module.get<CryptoService>(CryptoService);
      expect(() => svc.onModuleInit()).toThrow(
        'VAULT_ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters)',
      );
    });

    it('should not throw (only warn) when the key is missing', async () => {
      const module = await buildModule(undefined);
      const svc = module.get<CryptoService>(CryptoService);
      // onModuleInit logs a warning and returns — it must NOT throw
      expect(() => svc.onModuleInit()).not.toThrow();
    });
  });

  // ============================================================================
  // encrypt
  // ============================================================================

  describe('encrypt', () => {
    it('should return an object with ciphertext, iv, and authTag fields', () => {
      const result = service.encrypt('hello world');

      expect(result).toHaveProperty('ciphertext');
      expect(result).toHaveProperty('iv');
      expect(result).toHaveProperty('authTag');
      expect(typeof result.ciphertext).toBe('string');
      expect(typeof result.iv).toBe('string');
      expect(typeof result.authTag).toBe('string');
    });

    it('should return non-empty base64 strings', () => {
      const result = service.encrypt('test plaintext');

      expect(result.ciphertext.length).toBeGreaterThan(0);
      expect(result.iv.length).toBeGreaterThan(0);
      expect(result.authTag.length).toBeGreaterThan(0);
    });

    it('should produce unique IVs on every call even for the same plaintext', () => {
      const plaintext = 'identical input';
      const first = service.encrypt(plaintext);
      const second = service.encrypt(plaintext);

      // IVs must differ because randomBytes(12) is used each time
      expect(first.iv).not.toBe(second.iv);
    });

    it('should produce different ciphertexts for the same plaintext due to random IV', () => {
      const plaintext = 'same message';
      const first = service.encrypt(plaintext);
      const second = service.encrypt(plaintext);

      // With different IVs the ciphertext bytes differ
      expect(first.ciphertext).not.toBe(second.ciphertext);
    });

    it('should throw when the encryption key is not configured', async () => {
      const module = await buildModule(undefined);
      const svc = module.get<CryptoService>(CryptoService);
      svc.onModuleInit(); // key stays unset (logs warning, no-op)

      expect(() => svc.encrypt('data')).toThrow('Encryption key not configured');
    });
  });

  // ============================================================================
  // decrypt
  // ============================================================================

  describe('decrypt', () => {
    it('should decrypt ciphertext back to the original plaintext (round trip)', () => {
      const original = 'the quick brown fox';
      const { ciphertext, iv, authTag } = service.encrypt(original);

      const recovered = service.decrypt(ciphertext, iv, authTag);

      expect(recovered).toBe(original);
    });

    it('should handle an empty string round trip', () => {
      const { ciphertext, iv, authTag } = service.encrypt('');
      expect(service.decrypt(ciphertext, iv, authTag)).toBe('');
    });

    it('should handle unicode content in the round trip', () => {
      const original = '{"key":"valué","emoji":"🔐"}';
      const { ciphertext, iv, authTag } = service.encrypt(original);
      expect(service.decrypt(ciphertext, iv, authTag)).toBe(original);
    });

    it('should throw when the ciphertext has been tampered with', () => {
      const { ciphertext, iv, authTag } = service.encrypt('secret data');

      // Decode, flip one byte, re-encode
      const raw = Buffer.from(ciphertext, 'base64');
      raw[0] = raw[0] ^ 0xff;
      const tampered = raw.toString('base64');

      expect(() => service.decrypt(tampered, iv, authTag)).toThrow();
    });

    it('should throw when the auth tag has been tampered with', () => {
      const { ciphertext, iv, authTag } = service.encrypt('secret data');

      // Decode, flip one byte, re-encode
      const raw = Buffer.from(authTag, 'base64');
      raw[0] = raw[0] ^ 0xff;
      const tamperedTag = raw.toString('base64');

      expect(() => service.decrypt(ciphertext, iv, tamperedTag)).toThrow();
    });

    it('should throw when decrypting with the wrong IV', () => {
      const { ciphertext, authTag } = service.encrypt('secret data');
      const wrongIv = Buffer.alloc(12, 0xff).toString('base64');

      expect(() => service.decrypt(ciphertext, wrongIv, authTag)).toThrow();
    });

    it('should throw when the encryption key is not configured', async () => {
      const module = await buildModule(undefined);
      const svc = module.get<CryptoService>(CryptoService);
      svc.onModuleInit();

      expect(() => svc.decrypt('abc', 'iv', 'tag')).toThrow('Encryption key not configured');
    });
  });

  // ============================================================================
  // encrypt / decrypt cross-call independence
  // ============================================================================

  describe('encrypt/decrypt cross-call independence', () => {
    it('should correctly decrypt each independently encrypted value', () => {
      const a = 'value A';
      const b = 'value B';

      const encA = service.encrypt(a);
      const encB = service.encrypt(b);

      expect(service.decrypt(encA.ciphertext, encA.iv, encA.authTag)).toBe(a);
      expect(service.decrypt(encB.ciphertext, encB.iv, encB.authTag)).toBe(b);
    });

    it('should not be able to decrypt value A using the IV/tag from value B', () => {
      const encA = service.encrypt('value A');
      const encB = service.encrypt('value B');

      // Cross-mixing IV/tag should fail authentication or produce wrong output
      // AES-GCM will throw on auth failure or return garbage — both are wrong
      let result: string | undefined;
      let threw = false;

      try {
        result = service.decrypt(encA.ciphertext, encB.iv, encB.authTag);
      } catch {
        threw = true;
      }

      // Either an exception was thrown, or the decrypted value doesn't match the original
      if (!threw) {
        expect(result).not.toBe('value A');
      }
    });
  });
});
