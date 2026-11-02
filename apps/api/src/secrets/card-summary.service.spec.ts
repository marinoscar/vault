import { CardSummaryService, extractLast4, summarizeCardData } from './card-summary.service';
import { PERMISSIONS } from '../common/constants/roles.constants';

describe('extractLast4', () => {
  it.each([
    ['4111111111111111', '1111'],
    ['4111 1111 1111 1234', '1234'],
    ['4111-1111-1111-9876', '9876'],
    [' 3782 822463 10005 ', '0005'],
    ['1234', '1234'],
  ])('%s -> %s', (input, expected) => {
    expect(extractLast4(input)).toBe(expected);
  });

  it.each([[undefined], [null], [''], ['abc'], ['12 3'], [4111111111111111], [{}]])(
    'returns null for %p',
    (input) => {
      expect(extractLast4(input)).toBeNull();
    },
  );
});

describe('summarizeCardData', () => {
  it('reads only last4 and expiry, never cvv or the number', () => {
    const out = summarizeCardData({
      number: '4111 1111 1111 1111',
      exp_month: '3',
      exp_year: '27',
      cvv: '123',
      security_code_2: '999',
    });
    expect(out).toEqual({ last4: '1111', expMonth: 3, expYear: 2027 });
    const json = JSON.stringify(out);
    expect(json).not.toContain('123');
    expect(json).not.toContain('4111 1111');
  });

  it('accepts numeric month/year values', () => {
    expect(summarizeCardData({ number: '4111111111111111', exp_month: 12, exp_year: 2030 })).toEqual({
      last4: '1111',
      expMonth: 12,
      expYear: 2030,
    });
  });

  it('returns nulls for missing, malformed or out-of-range fields', () => {
    expect(summarizeCardData({})).toEqual({ last4: null, expMonth: null, expYear: null });
    expect(summarizeCardData(null)).toEqual({ last4: null, expMonth: null, expYear: null });
    expect(
      summarizeCardData({ number: 12, exp_month: '13', exp_year: '19999' }),
    ).toEqual({ last4: null, expMonth: null, expYear: null });
  });
});

describe('CardSummaryService', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  let findMany: jest.Mock;
  let decrypt: jest.Mock;
  let service: CardSummaryService;

  const row = (id: string, name: string, data: unknown, hasVersion = true) => ({
    id,
    name,
    updatedAt: now,
    versions: hasVersion ? [{ encryptedData: JSON.stringify(data), iv: 'iv', authTag: 'tag' }] : [],
  });

  beforeEach(() => {
    findMany = jest.fn();
    // The fake "ciphertext" is the plaintext itself, unless it is the poison value.
    decrypt = jest.fn((c: string) => {
      if (c === '"BAD"') throw new Error('auth failed');
      return c;
    });
    service = new CardSummaryService({ secret: { findMany } } as any, { decrypt } as any);
  });

  const card = (n: string, m: string, y: string) => ({ number: n, exp_month: m, exp_year: y, cvv: '777' });

  it('sorts by expiry, unknown last, then name; tolerates bad rows', async () => {
    findMany.mockResolvedValue([
      row('d', 'Zeta', card('4000 0000 0000 0004', '1', '2031')),
      row('a', 'Alpha', card('4000 0000 0000 0001', '05', '27')),
      row('n', 'NoExpiry', { number: '4000000000000009' }),
      { ...row('b', 'Broken', null), versions: [{ encryptedData: '"BAD"', iv: 'i', authTag: 't' }] },
      row('x', 'NoVersion', null, false),
      row('c', 'Beta', card('4000 0000 0000 0003', '5', '2027')),
    ]);

    const res = await service.list({ page: 1, pageSize: 20 }, 'u1', []);

    expect(res.items.map((i) => i.id)).toEqual(['a', 'c', 'd', 'b', 'n', 'x']);
    expect(res.items[0]).toEqual({ id: 'a', name: 'Alpha', last4: '0001', expMonth: 5, expYear: 2027, updatedAt: now });
    expect(res.items.find((i) => i.id === 'b')).toMatchObject({ last4: null, expMonth: null, expYear: null });
    expect(res.meta).toEqual({ page: 1, pageSize: 20, totalItems: 6, totalPages: 1 });
    expect(JSON.stringify(res)).not.toContain('777');
  });

  it('paginates after sorting', async () => {
    findMany.mockResolvedValue(
      ['1', '2', '3', '4', '5'].map((m, i) => row(`id${i}`, `C${i}`, card('4111111111111111', String(12 - i), '2030'))),
    );
    const res = await service.list({ page: 2, pageSize: 2 }, 'u1', []);
    // soonest first: month 8 (id4), 9 (id3), 10 (id2), ...
    expect(res.items.map((i) => i.id)).toEqual(['id2', 'id1']);
    expect(res.meta).toEqual({ page: 2, pageSize: 2, totalItems: 5, totalPages: 3 });
    const empty = await service.list({ page: 9, pageSize: 2 }, 'u1', []);
    expect(empty.items).toEqual([]);
  });

  it('scopes to the caller unless secrets:read_any, and only Card system type', async () => {
    findMany.mockResolvedValue([]);
    await service.list({ page: 1, pageSize: 20 }, 'u1', [PERMISSIONS.SECRETS_READ]);
    expect(findMany.mock.calls[0][0].where).toEqual({
      createdById: 'u1',
      type: { isSystem: true, name: 'Card' },
    });
    await service.list({ page: 1, pageSize: 20 }, 'u1', [PERMISSIONS.SECRETS_READ_ANY]);
    expect(findMany.mock.calls[1][0].where).toEqual({ type: { isSystem: true, name: 'Card' } });
  });
});
