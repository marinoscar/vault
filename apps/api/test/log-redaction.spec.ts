import { Logger } from '@nestjs/common';

import { installLogRedaction, redactLogText } from '../src/platform/log-redaction';

const TOKEN = 'vbk_' + 'A1b2C3d4E5f6G7h8I9j0';

describe('log redaction', () => {
  it('masks query-string values and keeps the path and the keys', () => {
    expect(redactLogText('GET /api/secrets?access_token=abc&q=hello%20x - 401')).toBe(
      'GET /api/secrets?access_token=[redacted]&q=[redacted] - 401',
    );
  });

  it.each(['vbk', 'pat', 'oat', 'nod'])('masks a %s_ token anywhere in the text', (family) => {
    const token = `${family}_Zy9-x_W8v7U6t5S4r3Q2`;
    const out = redactLogText(`header leaked ${token} here`);
    expect(out).not.toContain(token);
    expect(out).toContain(`${family}_[redacted]`);
  });

  it('leaves non-token text untouched', () => {
    for (const text of ['GET /api/secrets - 200', 'pat_short is fine', 'carpet_abcdefghijklmnopqrstu', 'plain message', '']) {
      expect(redactLogText(text)).toBe(text);
    }
  });

  it('is idempotent', () => {
    const once = redactLogText(`/x?token=${TOKEN}`);
    expect(redactLogText(once)).toBe(once);
    expect(once).not.toContain(TOKEN);
  });

  it('redacts through the Nest Logger facade, once installed', () => {
    installLogRedaction();
    installLogRedaction();
    const seen: string[] = [];
    Logger.overrideLogger({ warn: (m: unknown) => void seen.push(String(m)) } as never);
    try {
      new Logger('Test').warn(`GET /api/x?access_token=${TOKEN} - 401`);
    } finally {
      Logger.overrideLogger(undefined as never);
    }
    expect(seen).toEqual(['GET /api/x?access_token=[redacted] - 401']);
  });
});
