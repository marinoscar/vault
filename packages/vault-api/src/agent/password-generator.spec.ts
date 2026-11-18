import { generatePassword } from './password-generator';

describe('generatePassword', () => {
  const classes = {
    lower: /[a-z]/,
    upper: /[A-Z]/,
    digit: /[0-9]/,
    symbol: /[^A-Za-z0-9]/,
  };

  it('honours the requested length across the whole range', () => {
    for (const length of [12, 13, 24, 64, 127, 128]) {
      expect(generatePassword({ length })).toHaveLength(length);
    }
    expect(generatePassword()).toHaveLength(24);
  });

  it('has at least one of every enabled class, every time (property)', () => {
    for (let i = 0; i < 500; i++) {
      const length = 12 + (i % 117);
      const pw = generatePassword({ length, symbols: true });
      for (const [name, re] of Object.entries(classes)) expect([name, re.test(pw)]).toEqual([name, true]);
    }
  });

  it('with symbols off uses letters and digits only', () => {
    for (let i = 0; i < 300; i++) {
      const pw = generatePassword({ length: 12 + (i % 40), symbols: false });
      expect(/^[A-Za-z0-9]+$/.test(pw)).toBe(true);
      expect(classes.lower.test(pw) && classes.upper.test(pw) && classes.digit.test(pw)).toBe(true);
    }
  });

  it('does not repeat and does not fix the guaranteed characters at the start', () => {
    const seen = new Set<string>();
    const firstClasses = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const pw = generatePassword({ length: 24 });
      seen.add(pw);
      firstClasses.add(/[a-z]/.test(pw[0]!) ? 'l' : /[A-Z]/.test(pw[0]!) ? 'u' : /[0-9]/.test(pw[0]!) ? 'd' : 's');
    }
    expect(seen.size).toBe(200);
    expect(firstClasses.size).toBeGreaterThan(1);
  });

  it('rejects an out-of-range or non-integer length', () => {
    for (const length of [0, 11, 129, 12.5, Number.NaN]) {
      expect(() => generatePassword({ length })).toThrow(RangeError);
    }
  });
});
