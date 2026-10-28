import { existsSync } from 'fs';

/**
 * Points the app at the dedicated test database and Redis db 1, so e2e runs never touch dev data.
 * Real environment variables (CI) win over the local .env file.
 */
export function applyTestEnv(): void {
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  process.env.NODE_ENV = 'test';
  process.env.DB_NAME = process.env.DB_TEST_NAME ?? 'risotto_test';

  const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  redisUrl.pathname = '/1';
  process.env.REDIS_URL = redisUrl.toString();
}

applyTestEnv();
