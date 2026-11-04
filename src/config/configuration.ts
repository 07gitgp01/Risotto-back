export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  corsOrigins: string[];
  /** Express "trust proxy" value (hop count or 'loopback'). */
  trustProxy: number | 'loopback';
  db: {
    /** Full connection string; when set, the separate fields are ignored. */
    url?: string;
    ssl: boolean;
    /** PEM CA certificate checked when `ssl` is on; empty = system CAs. */
    sslCa: string;
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
    authTtlMs: number;
    authLimit: number;
  };
  auth: {
    jwtAccessSecret: string;
    jwtAccessTtlSeconds: number;
    refreshTokenTtlDays: number;
    tokenHashSecret: string;
    passwordResetTtlMinutes: number;
    passwordResetMaxAttempts: number;
    loginMaxFailures: number;
    loginLockMinutes: number;
  };
  mail: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
    from: string;
  };
  uploads: {
    photoMaxBytes: number;
  };
  messaging: {
    /** AES-256-GCM key for messages at rest (base64, 32 bytes). */
    encryptionKey: string;
  };
  push: {
    /** Firebase service account JSON file; empty = push disabled. */
    fcmServiceAccountPath: string;
  };
}

export function parseCorsOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function parseTrustProxy(raw: string | undefined): number | 'loopback' {
  return raw && /^\d+$/.test(raw) ? Number(raw) : 'loopback';
}

/**
 * Drops the TLS query parameters (`sslmode=require`… as in Supabase URLs): pg lets
 * them override the `ssl` option, which would discard the CA from DB_SSL_CA.
 * TLS is driven by DB_SSL / DB_SSL_CA only.
 */
export function stripSslParams(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  const [base, query] = url.split('?', 2);
  const kept = (query ?? '')
    .split('&')
    .filter((param) => param && !/^(ssl[a-z]*|uselibpqcompat)=/i.test(param));
  return kept.length > 0 ? `${base}?${kept.join('&')}` : base;
}

/**
 * Rebuilds PEM certificates mangled when pasted into a hosting dashboard: line
 * breaks lost or escaped ("\n"), or the BEGIN/END lines left out.
 */
export function normalizePem(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  const blocks = value.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  const bodies = blocks
    ? blocks.map((block) => block.replace(/-----(BEGIN|END) CERTIFICATE-----/g, ''))
    : [value];
  return bodies
    .map((body) => body.replace(/\\n|\s/g, ''))
    .filter((body) => /^[A-Za-z0-9+/]+=*$/.test(body))
    .map((body) =>
      ['-----BEGIN CERTIFICATE-----', ...body.match(/.{1,64}/g)!, '-----END CERTIFICATE-----'].join(
        '\n',
      ),
    )
    .join('\n');
}

/** Builds the typed config from already-validated env variables. */
export default (): AppConfig => ({
  nodeEnv: (process.env.NODE_ENV as AppConfig['nodeEnv']) ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  db: {
    url: stripSslParams(process.env.DATABASE_URL),
    ssl: process.env.DB_SSL === 'true',
    sslCa: normalizePem(process.env.DB_SSL_CA),
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
    authTtlMs: Number(process.env.THROTTLE_AUTH_TTL_MS ?? 60_000),
    authLimit: Number(process.env.THROTTLE_AUTH_LIMIT ?? 10),
  },
  auth: {
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    jwtAccessTtlSeconds: Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 900),
    refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
    tokenHashSecret: process.env.TOKEN_HASH_SECRET ?? '',
    passwordResetTtlMinutes: Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? 30),
    passwordResetMaxAttempts: Number(process.env.PASSWORD_RESET_MAX_ATTEMPTS ?? 5),
    loginMaxFailures: Number(process.env.LOGIN_MAX_FAILURES ?? 10),
    loginLockMinutes: Number(process.env.LOGIN_LOCK_MINUTES ?? 15),
  },
  mail: {
    host: process.env.SMTP_HOST ?? 'localhost',
    port: Number(process.env.SMTP_PORT ?? 1025),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER ?? '',
    password: process.env.SMTP_PASSWORD ?? '',
    from: process.env.MAIL_FROM ?? 'Risotto <no-reply@risotto.local>',
  },
  uploads: {
    photoMaxBytes: Number(process.env.PHOTO_MAX_BYTES ?? 5 * 1024 * 1024),
  },
  messaging: {
    encryptionKey: process.env.MESSAGE_ENCRYPTION_KEY ?? '',
  },
  push: {
    fcmServiceAccountPath: process.env.FCM_SERVICE_ACCOUNT_PATH ?? '',
  },
});
