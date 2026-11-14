import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkRevokeAllowed, parseCreateTokenOptions } from '../commands/auth-token.js';
import {
  currentTokenCandidates,
  defaultTokenName,
  describeExpiry,
  findCurrentToken,
  maskToken,
  parseDurationText,
  parseTokenDuration,
  parseTokenUnit,
  replaceStoredToken,
  resolveTokenName,
  type PatCreated,
  type PatListItem,
  type ReplaceTokenDeps,
} from '../lib/tokens.js';
import { getStoredTokenMeta, getTokenSource, platformConfigFile, saveToken } from '../utils/config.js';
import {
  canOfferRevoke,
  currentTokenRows,
  durationChoices,
  expiryAdvice,
  parseCustomInput,
  presetFromValue,
} from '../tui/token-logic.js';

const NOW = new Date('2026-03-01T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const inDays = (n: number): string => new Date(NOW.getTime() + n * DAY).toISOString();

// Invented tokens only.
const STORED = 'pat_abcdexampleexampleexampleexampleexampleexampleexampleexample00';
const NEW = 'pat_9f9fexampleexampleexampleexampleexampleexampleexampleexample11';

function row(over: Partial<PatListItem> = {}): PatListItem {
  return {
    id: 'tok-1',
    name: 'Token A',
    tokenPrefix: 'pat_abcd',
    expiresAt: inDays(87),
    lastUsedAt: null,
    createdAt: inDays(-3),
    revokedAt: null,
    ...over,
  };
}

describe('validation', () => {
  it('accepts durations 1 to 999 and rejects the rest', () => {
    expect(parseTokenDuration('1')).toBe(1);
    expect(parseTokenDuration(999)).toBe(999);
    for (const bad of ['0', '1000', '-5', '2.5', 'ten', '']) expect(() => parseTokenDuration(bad)).toThrow(/1 to 999/);
  });

  it('accepts the three units and their short forms', () => {
    expect(parseTokenUnit('days')).toBe('days');
    expect(parseTokenUnit('Month')).toBe('months');
    expect(parseTokenUnit('min')).toBe('minutes');
    expect(() => parseTokenUnit('years')).toThrow(/minutes, days, months/);
  });

  it('parses free-form lifetimes, years as months', () => {
    expect(parseDurationText('18 months')).toEqual({ duration: 18, unit: 'months' });
    expect(parseDurationText('45d')).toEqual({ duration: 45, unit: 'days' });
    expect(parseDurationText('2 years')).toEqual({ duration: 24, unit: 'months' });
    expect(() => parseDurationText('forever')).toThrow();
    expect(() => parseDurationText('100 years')).toThrow(/1 to 999/);
  });

  it('defaults the name to vault-cli <host> <date> and validates a given one', () => {
    expect(defaultTokenName(NOW, 'host-a')).toBe('vault-cli host-a 2026-03-01');
    expect(resolveTokenName(undefined, NOW, 'host-a')).toBe('vault-cli host-a 2026-03-01');
    expect(resolveTokenName('  backups  ')).toBe('backups');
    expect(() => resolveTokenName('   ')).toThrow(/1 to 100/);
    expect(() => resolveTokenName('x'.repeat(101))).toThrow(/1 to 100/);
  });

  it('validates the create options', () => {
    const ctx = { tokenSource: 'config' as const, now: NOW, host: 'host-a' };
    expect(parseCreateTokenOptions({ duration: '12', unit: 'months', store: true, revokeCurrent: true }, ctx)).toEqual({
      duration: 12,
      unit: 'months',
      name: 'vault-cli host-a 2026-03-01',
      store: true,
      revokeCurrent: true,
    });
    expect(() => parseCreateTokenOptions({ unit: 'days' }, ctx)).toThrow(/--duration/);
    expect(() => parseCreateTokenOptions({ duration: '5' }, ctx)).toThrow(/--unit/);
    expect(() => parseCreateTokenOptions({ duration: '1000', unit: 'days' }, ctx)).toThrow(/1 to 999/);
    expect(() => parseCreateTokenOptions({ duration: '5', unit: 'days', revokeCurrent: true }, ctx)).toThrow(/needs --store/);
    expect(() =>
      parseCreateTokenOptions({ duration: '5', unit: 'days', store: true, revokeCurrent: true }, { ...ctx, tokenSource: 'environment' }),
    ).toThrow(/environment variable/);
  });
});

describe('display', () => {
  it('describes the expiry with a warning under 14 days', () => {
    expect(describeExpiry(inDays(87), NOW)).toEqual({ text: 'in 87 days', level: 'ok', daysLeft: 87 });
    expect(describeExpiry(inDays(13), NOW).level).toBe('warning');
    expect(describeExpiry(inDays(1), NOW).text).toBe('in 24 hours');
    expect(describeExpiry(new Date(NOW.getTime() + 5 * 60_000).toISOString(), NOW).text).toBe('in 5 minutes');
    expect(describeExpiry(inDays(-1), NOW)).toMatchObject({ text: 'expired', level: 'expired' });
    expect(describeExpiry(undefined, NOW)).toMatchObject({ text: 'unknown', level: 'unknown' });
    expect(describeExpiry('not a date', NOW).level).toBe('unknown');
  });

  it('never returns the token from maskToken', () => {
    expect(maskToken(STORED)).toBe('pat_abcd…');
    expect(maskToken('short')).toBe('********');
    expect(maskToken(undefined)).toBe('********');
  });
});

describe('finding the current token', () => {
  const list = [row(), row({ id: 'tok-2', name: 'Token B', tokenPrefix: 'pat_1234' })];

  it('prefers the stored token id', () => {
    expect(findCurrentToken(list, STORED, 'tok-2', NOW)?.id).toBe('tok-2');
  });

  it('falls back to a unique active prefix match', () => {
    expect(findCurrentToken(list, STORED, undefined, NOW)?.id).toBe('tok-1');
    expect(findCurrentToken(list, NEW, undefined, NOW)).toBeUndefined();
    expect(findCurrentToken(list, undefined, undefined, NOW)).toBeUndefined();
  });

  it('ignores revoked and expired rows and gives up when the prefix is ambiguous', () => {
    expect(findCurrentToken([row({ revokedAt: inDays(-1) })], STORED, undefined, NOW)).toBeUndefined();
    expect(findCurrentToken([row({ expiresAt: inDays(-1) })], STORED, undefined, NOW)).toBeUndefined();
    const twins = [row(), row({ id: 'tok-3' })];
    expect(findCurrentToken(twins, STORED, undefined, NOW)).toBeUndefined();
    expect(currentTokenCandidates(twins, STORED, undefined, NOW)).toHaveLength(2);
  });

  it('refuses to revoke the current (or possibly current) token without --yes', () => {
    expect(() => checkRevokeAllowed('tok-1', list, STORED, undefined, false, NOW)).toThrow(/--yes/);
    expect(() => checkRevokeAllowed('tok-1', list, STORED, undefined, true, NOW)).not.toThrow();
    expect(() => checkRevokeAllowed('tok-2', list, STORED, undefined, false, NOW)).not.toThrow();
    const twins = [row(), row({ id: 'tok-3' })];
    expect(() => checkRevokeAllowed('tok-3', twins, STORED, undefined, false, NOW)).toThrow(/may be/);
  });
});

describe('replaceStoredToken', () => {
  const created: PatCreated = {
    token: NEW,
    id: 'tok-new',
    name: 'vault-cli host-a 2026-03-01',
    tokenPrefix: 'pat_9f9f',
    expiresAt: inDays(365),
    createdAt: NOW.toISOString(),
  };
  const newRow = row({ id: 'tok-new', tokenPrefix: 'pat_9f9f', expiresAt: created.expiresAt });

  function deps(over: Partial<ReplaceTokenDeps> = {}): ReplaceTokenDeps & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      create: vi.fn(async () => {
        calls.push('create');
        return created;
      }),
      list: vi.fn(async (opts?: { token?: string }) => {
        calls.push(opts?.token === NEW ? 'list:new' : 'list:old');
        return opts?.token === NEW ? [newRow, row()] : [row()];
      }),
      revoke: vi.fn(async (id: string, opts?: { token?: string }) => {
        calls.push(`revoke:${id}:${opts?.token === NEW ? 'new' : 'old'}`);
      }),
      store: vi.fn(() => {
        calls.push('store');
        return '/home/a/.vault/config.json';
      }),
      storedToken: () => STORED,
      storedTokenId: () => undefined,
      serverUrl: () => 'https://vault.example.test',
      now: () => NOW,
      ...over,
    };
  }

  it('creates, stores, verifies with the new token, then revokes the old one with it', async () => {
    const d = deps();
    const result = await replaceStoredToken({ duration: 12, unit: 'months', name: created.name, revokePrevious: true }, d);
    expect(d.calls).toEqual(['list:old', 'create', 'store', 'list:new', 'revoke:tok-1:new']);
    expect(result.revokedPrevious).toBe(true);
    expect(result.previous?.id).toBe('tok-1');
    expect(JSON.stringify(result)).not.toContain(NEW);
  });

  it('leaves the old token alone when not asked to revoke', async () => {
    const d = deps();
    const result = await replaceStoredToken({ duration: 90, unit: 'days', name: 'n', revokePrevious: false }, d);
    expect(d.calls).not.toContain('revoke:tok-1:new');
    expect(result.revokedPrevious).toBe(false);
  });

  it('never revokes when verification fails', async () => {
    const d = deps({
      list: vi.fn(async (opts?: { token?: string }) => {
        if (opts?.token === NEW) throw new Error('HTTP 401');
        return [row()];
      }),
    });
    await expect(replaceStoredToken({ duration: 1, unit: 'months', name: 'n', revokePrevious: true }, d)).rejects.toThrow(
      /could not be verified.*not revoked/,
    );
    expect(d.revoke).not.toHaveBeenCalled();
  });

  it('creates nothing when --revoke-current cannot identify the current token', async () => {
    const d = deps({ storedToken: () => NEW });
    await expect(replaceStoredToken({ duration: 1, unit: 'months', name: 'n', revokePrevious: true }, d)).rejects.toThrow(
      /nothing was created/,
    );
    expect(d.create).not.toHaveBeenCalled();
  });
});

describe('storing the token (saveToken with metadata)', () => {
  let home: string;
  const saved = { HOME: process.env.HOME, VAULT_TOKEN: process.env.VAULT_TOKEN };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'vault-cli-token-'));
    process.env.HOME = home;
    delete process.env.VAULT_TOKEN;
  });
  afterEach(() => {
    process.env.HOME = saved.HOME;
    if (saved.VAULT_TOKEN === undefined) delete process.env.VAULT_TOKEN;
    else process.env.VAULT_TOKEN = saved.VAULT_TOKEN;
    rmSync(home, { recursive: true, force: true });
  });

  it('records the new token metadata the platform reads, mode 0600, keeping the server', () => {
    saveToken(STORED, 'https://vault.example.test', { expiresAt: inDays(5), tokenId: 'old', tokenName: 'old' });
    const file = saveToken(NEW, 'https://vault.example.test', { expiresAt: inDays(365), tokenId: 'tok-new', tokenName: 'Token N' });
    expect(file).toBe(platformConfigFile());
    const cfg = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(cfg).toMatchObject({ serverUrl: 'https://vault.example.test', token: NEW, tokenId: 'tok-new', tokenName: 'Token N' });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(getTokenSource()).toBe('config');
    expect(getStoredTokenMeta().tokenId).toBe('tok-new');
  });

  it('reports the environment as the token source when VAULT_TOKEN is set', () => {
    saveToken(STORED, 'https://vault.example.test', { tokenId: 'tok-1' });
    process.env.VAULT_TOKEN = NEW;
    expect(getTokenSource()).toBe('environment');
    expect(getStoredTokenMeta()).toEqual({});
  });
});

describe('TUI screen logic', () => {
  const local = {
    serverUrl: 'https://vault.example.test',
    source: 'config' as const,
    hint: 'pat_abcd…',
    tokenId: undefined,
    tokenName: 'From login',
    expiresAt: inDays(10),
  };

  it('offers the presets, Custom and Back', () => {
    const values = durationChoices().map((c) => c.value);
    expect(values).toEqual(['90:days', '6:months', '12:months', '24:months', 'custom', 'back']);
    expect(presetFromValue('12:months')).toEqual({ duration: 12, unit: 'months' });
    expect(presetFromValue('custom')).toBeUndefined();
  });

  it('parses custom input into a duration or a message', () => {
    expect(parseCustomInput('3 months')).toEqual({ ok: true, value: { duration: 3, unit: 'months' } });
    expect(parseCustomInput('soon')).toMatchObject({ ok: false });
  });

  it('colours the expiry and advises a replacement when it is close', () => {
    const rows = currentTokenRows(local, undefined, NOW);
    expect(rows.find((r) => r.label === 'Expires')).toMatchObject({ color: 'yellow' });
    expect(rows.find((r) => r.label === 'Name')?.value).toBe('From login');
    expect(expiryAdvice(local, undefined, NOW)).toMatch(/longer-lived/);
    expect(expiryAdvice(local, row(), NOW)).toBeUndefined();
    expect(currentTokenRows(local, row(), NOW).find((r) => r.label === 'Expires')).toMatchObject({ color: 'green' });
    expect(expiryAdvice({ ...local, source: undefined }, undefined, NOW)).toMatch(/Login/);
  });

  it('offers revoking the old token only when known and not from the environment', () => {
    expect(canOfferRevoke(local, row(), 'tok-new')).toBe(true);
    expect(canOfferRevoke(local, undefined, 'tok-new')).toBe(false);
    expect(canOfferRevoke({ ...local, source: 'environment' }, row(), 'tok-new')).toBe(false);
  });
});
