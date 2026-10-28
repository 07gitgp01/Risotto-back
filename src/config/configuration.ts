export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  corsOrigins: string[];
  db: {
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
  };
  redisUrl: string;
  throttle: {
    ttlMs: number;
    limit: number;
  };
}

export function parseCorsOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/** Builds the typed config from already-validated env variables. */
export default (): AppConfig => ({
  nodeEnv: (process.env.NODE_ENV as AppConfig['nodeEnv']) ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
  db: {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? '',
    password: process.env.DB_PASSWORD ?? '',
    name: process.env.DB_NAME ?? '',
  },
  redisUrl: process.env.REDIS_URL ?? '',
  throttle: {
    ttlMs: Number(process.env.THROTTLE_TTL_MS ?? 60_000),
    limit: Number(process.env.THROTTLE_LIMIT ?? 100),
  },
});
