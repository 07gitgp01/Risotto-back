import { validateEnv } from './env.validation';

const validEnv = {
  DB_HOST: 'localhost',
  DB_USER: 'risotto',
  DB_PASSWORD: 'secret',
  DB_NAME: 'risotto',
  REDIS_URL: 'redis://localhost:6379/0',
};

describe('validateEnv', () => {
  it('accepts a minimal valid environment and applies defaults', () => {
    const env = validateEnv({ ...validEnv });
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      DB_PORT: 5432,
      THROTTLE_TTL_MS: 60_000,
      THROTTLE_LIMIT: 100,
    });
  });

  it('coerces numeric strings', () => {
    const env = validateEnv({ ...validEnv, PORT: '4000', DB_PORT: '5433' });
    expect(env.PORT).toBe(4000);
    expect(env.DB_PORT).toBe(5433);
  });

  it.each(['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'REDIS_URL'])(
    'rejects a missing %s',
    (key) => {
      const env: Record<string, unknown> = { ...validEnv };
      delete env[key];
      expect(() => validateEnv(env)).toThrow(key);
    },
  );

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnv({ ...validEnv, NODE_ENV: 'staging' })).toThrow('NODE_ENV');
  });

  it('rejects a non-redis REDIS_URL', () => {
    expect(() => validateEnv({ ...validEnv, REDIS_URL: 'http://localhost' })).toThrow('REDIS_URL');
  });

  it('reports every error at once', () => {
    expect(() => validateEnv({})).toThrow(/DB_HOST.*DB_USER/s);
  });
});
