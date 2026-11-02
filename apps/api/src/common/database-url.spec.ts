import { buildDatabaseUrl } from './database-url';
import configuration from '../config/configuration';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { constructDatabaseUrl } = require('../../scripts/prisma-env.js');

describe('buildDatabaseUrl', () => {
  const env = {
    POSTGRES_HOST: 'db',
    POSTGRES_PORT: '5433',
    POSTGRES_USER: 'us@er',
    POSTGRES_PASSWORD: 'p@ss/w:rd#?',
    POSTGRES_DB: 'vault',
  };
  const expected =
    'postgresql://us%40er:p%40ss%2Fw%3Ard%23%3F@db:5433/vault';

  it('encodes user and password containing @ and /', () => {
    expect(buildDatabaseUrl(env)).toBe(expected);
  });

  it('adds sslmode when POSTGRES_SSL is true', () => {
    expect(buildDatabaseUrl({ ...env, POSTGRES_SSL: 'true' })).toBe(
      `${expected}?sslmode=require`,
    );
  });

  it('returns an explicit DATABASE_URL untouched', () => {
    expect(buildDatabaseUrl({ DATABASE_URL: 'postgresql://x:y@h/d' })).toBe(
      'postgresql://x:y@h/d',
    );
  });

  it('matches scripts/prisma-env.js', () => {
    expect(constructDatabaseUrl(env)).toBe(buildDatabaseUrl(env));
  });

  it('configuration() exposes the encoded url and does not set DATABASE_URL', () => {
    const saved = { ...process.env };
    delete process.env.DATABASE_URL;
    Object.assign(process.env, env);
    try {
      const cfg = configuration() as any;
      expect(cfg.database.url).toBe(expected);
      expect(process.env.DATABASE_URL).toBeUndefined();
    } finally {
      process.env = saved;
    }
  });
});
