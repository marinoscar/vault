import { describe, expect, it } from 'vitest';

import { AI_ERROR_CODES, VAULT_ERROR_CODES, isVaultErrorCode } from '../src/errors/index.js';

describe('VAULT_ERROR_CODES', () => {
  it('has no two entries with the same code and a description for each', () => {
    const codes = VAULT_ERROR_CODES.map((def) => def.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const def of VAULT_ERROR_CODES) expect(def.description.length, def.code).toBeGreaterThan(10);
  });

  it('carries a valid HTTP error status for every code', () => {
    for (const def of VAULT_ERROR_CODES) {
      expect(Number.isInteger(def.status), def.code).toBe(true);
      expect(def.status, def.code).toBeGreaterThanOrEqual(400);
      expect(def.status, def.code).toBeLessThan(600);
    }
  });

  it('registers every AI_ERROR_CODES value, with the statuses clients depend on', () => {
    const byCode = new Map(VAULT_ERROR_CODES.map((def) => [def.code, def.status]));
    for (const code of Object.values(AI_ERROR_CODES)) expect(byCode.has(code), code).toBe(true);
    expect(byCode.get('AI_NOT_CONFIGURED')).toBe(503);
    expect(byCode.get('AI_INVALID_IMAGE')).toBe(400);
    expect(byCode.get('AI_RATE_LIMITED')).toBe(429);
    expect(byCode.get('AI_QUOTA_EXCEEDED')).toBe(429);
    expect(byCode.get('AI_UPSTREAM_AUTH')).toBe(502);
    expect(byCode.get('AI_UPSTREAM_UNAVAILABLE')).toBe(502);
    expect(byCode.get('AI_EXTRACTION_FAILED')).toBe(422);
    expect(byCode.get('DATABASE_SEED_REQUIRED')).toBe(500);
    expect(byCode.get('ENCRYPTION_UNAVAILABLE')).toBe(503);
  });

  it('answers isVaultErrorCode', () => {
    expect(isVaultErrorCode('AI_RATE_LIMITED')).toBe(true);
    expect(isVaultErrorCode('NOT_A_CODE')).toBe(false);
  });
});
