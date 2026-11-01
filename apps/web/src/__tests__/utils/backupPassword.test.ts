import { describe, it, expect } from 'vitest';
import {
  BACKUP_PASSWORD_MAX_LENGTH,
  BACKUP_PASSWORD_MIN_LENGTH,
  BACKUP_WORD_LIST,
  isSingleWord,
  shouldWarnBackupPassword,
  suggestBackupPassword,
  validateBackupPassword,
  type RandomValues,
} from '../../utils/backupPassword';

/** Deterministic "random" source that yields the given numbers in order. */
function sequence(values: number[]): RandomValues {
  let i = 0;
  return (array) => {
    array[0] = values[i++ % values.length];
    return array;
  };
}

describe('BACKUP_WORD_LIST', () => {
  it('has only unique, lowercase, simple words', () => {
    expect(new Set(BACKUP_WORD_LIST).size).toBe(BACKUP_WORD_LIST.length);
    for (const word of BACKUP_WORD_LIST) {
      expect(word).toMatch(/^[a-z]+$/);
    }
  });
});

describe('suggestBackupPassword', () => {
  it('uses 3 words from the list, joined by spaces, via the injected random source', () => {
    const words = ['alpha', 'bravo', 'charlie', 'delta'];
    const result = suggestBackupPassword({ words, random: sequence([0, 1, 6]) });
    // 6 % 4 === 2
    expect(result).toBe('alpha bravo charlie');
  });

  it('defaults to the built-in list and three words', () => {
    const result = suggestBackupPassword({ random: sequence([0, 1, 2]) });
    expect(result).toBe(
      [BACKUP_WORD_LIST[0], BACKUP_WORD_LIST[1], BACKUP_WORD_LIST[2]].join(' '),
    );
    expect(result.split(' ')).toHaveLength(3);
  });

  it('works with the real WebCrypto source', () => {
    const result = suggestBackupPassword();
    const parts = result.split(' ');
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(BACKUP_WORD_LIST).toContain(part);
    }
  });

  it('honours a custom count', () => {
    expect(suggestBackupPassword({ count: 5 }).split(' ')).toHaveLength(5);
  });

  it('rejects values in the biased tail instead of using them', () => {
    // With 3 words, limit = floor(2^32 / 3) * 3 = 4294967295; 0xffffffff is rejected.
    const random: RandomValues = sequence([0xffffffff, 1, 1, 1]);
    const result = suggestBackupPassword({
      words: ['a', 'b', 'c'],
      count: 1,
      random,
    });
    expect(result).toBe('b');
  });

  it('throws on an empty word list', () => {
    expect(() => suggestBackupPassword({ words: [] })).toThrow();
  });

  it('produces a password that passes validation and no warning', () => {
    const suggestion = suggestBackupPassword();
    expect(validateBackupPassword(suggestion, suggestion)).toBeNull();
  });
});

describe('validateBackupPassword', () => {
  it('requires the minimum length', () => {
    expect(BACKUP_PASSWORD_MIN_LENGTH).toBe(6);
    expect(validateBackupPassword('12345', '12345')).toBe(
      'Password must be at least 6 characters',
    );
    expect(validateBackupPassword('', '')).toBe('Password must be at least 6 characters');
  });

  it('accepts exactly 6 characters', () => {
    expect(validateBackupPassword('123456', '123456')).toBeNull();
  });

  it('enforces the maximum length', () => {
    expect(BACKUP_PASSWORD_MAX_LENGTH).toBe(256);
    const ok = 'a'.repeat(256);
    expect(validateBackupPassword(ok, ok)).toBeNull();
    const tooLong = 'a'.repeat(257);
    expect(validateBackupPassword(tooLong, tooLong)).toBe(
      'Password must be at most 256 characters',
    );
  });

  it('reports a mismatch', () => {
    expect(validateBackupPassword('sunshine', 'sunshin')).toBe('Passwords do not match');
    expect(validateBackupPassword('sunshine', '')).toBe('Passwords do not match');
  });

  it('checks length before mismatch', () => {
    expect(validateBackupPassword('abc', 'abd')).toBe(
      'Password must be at least 6 characters',
    );
  });

  it('applies no complexity rules', () => {
    expect(validateBackupPassword('aaaaaa', 'aaaaaa')).toBeNull();
    expect(validateBackupPassword('      ', '      ')).toBeNull();
  });
});

describe('isSingleWord', () => {
  it.each([
    ['sunshine', true],
    ['  sunshine  ', true],
    ['', true],
    ['blue tiger', false],
    ['blue  tiger  river', false],
  ])('%j -> %s', (input, expected) => {
    expect(isSingleWord(input)).toBe(expected);
  });
});

describe('shouldWarnBackupPassword', () => {
  it('does not warn for an empty password', () => {
    expect(shouldWarnBackupPassword('')).toBe(false);
  });

  it('warns for passwords under 12 characters', () => {
    expect(shouldWarnBackupPassword('abc def')).toBe(true);
    expect(shouldWarnBackupPassword('a b c d e f')).toBe(true); // 11 chars
  });

  it('warns for a single long word', () => {
    expect(shouldWarnBackupPassword('internationalization')).toBe(true);
  });

  it('does not warn for a three-word phrase', () => {
    expect(shouldWarnBackupPassword('blue tiger river')).toBe(false);
  });

  it('does not warn at exactly 12 characters with two words', () => {
    expect(shouldWarnBackupPassword('abcde fghijk')).toBe(false); // 12 chars
  });
});
