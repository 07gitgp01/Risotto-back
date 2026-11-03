import * as Joi from 'joi';

/** Base64 string that decodes to exactly 32 bytes (AES-256 key). */
const aes256Key = Joi.string().custom((value: string, helpers) => {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== value) {
    return helpers.error('any.invalid');
  }
  return value;
}, 'base64-encoded 32-byte key');

export const envValidationSchema = Joi.object<Record<string, unknown>>({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  CORS_ORIGINS: Joi.string().allow('').default(''),

  // Either a full connection string (hosted databases) or the separate DB_* fields.
  DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }),
  DB_HOST: Joi.string().when('DATABASE_URL', { is: Joi.exist(), otherwise: Joi.required() }),
  DB_PORT: Joi.number().port().default(5432),
  DB_USER: Joi.string().when('DATABASE_URL', { is: Joi.exist(), otherwise: Joi.required() }),
  DB_PASSWORD: Joi.string().when('DATABASE_URL', {
    is: Joi.exist(),
    otherwise: Joi.required(),
  }),
  DB_NAME: Joi.string().when('DATABASE_URL', { is: Joi.exist(), otherwise: Joi.required() }),
  // TLS to the database (external connections to a hosted database).
  DB_SSL: Joi.boolean().default(false),
  // PEM certificate of the database's CA (e.g. Supabase), to verify the server.
  DB_SSL_CA: Joi.string().allow('').default(''),

  // Express "trust proxy": hop count behind a hosting proxy (e.g. 1), or 'loopback'.
  TRUST_PROXY: Joi.alternatives()
    .try(Joi.number().integer().min(0), Joi.string().valid('loopback'))
    .default('loopback'),

  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),

  THROTTLE_TTL_MS: Joi.number().integer().positive().default(60_000),
  THROTTLE_LIMIT: Joi.number().integer().positive().default(100),
  THROTTLE_AUTH_TTL_MS: Joi.number().integer().positive().default(60_000),
  THROTTLE_AUTH_LIMIT: Joi.number().integer().positive().default(10),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL_SECONDS: Joi.number().integer().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: Joi.number().integer().positive().default(30),
  TOKEN_HASH_SECRET: Joi.string().min(32).required(),
  PASSWORD_RESET_TTL_MINUTES: Joi.number().integer().positive().default(30),
  PASSWORD_RESET_MAX_ATTEMPTS: Joi.number().integer().positive().default(5),
  LOGIN_MAX_FAILURES: Joi.number().integer().positive().default(10),
  LOGIN_LOCK_MINUTES: Joi.number().integer().positive().default(15),

  SMTP_HOST: Joi.string().required(),
  SMTP_PORT: Joi.number().port().default(1025),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASSWORD: Joi.string().allow('').default(''),
  MAIL_FROM: Joi.string().default('Risotto <no-reply@risotto.local>'),

  MESSAGE_ENCRYPTION_KEY: aes256Key.required(),

  // Optional: push notifications are disabled when empty.
  FCM_SERVICE_ACCOUNT_PATH: Joi.string().allow('').default(''),

  PHOTO_MAX_BYTES: Joi.number()
    .integer()
    .positive()
    .default(5 * 1024 * 1024),
});

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const result = envValidationSchema.validate(config, {
    allowUnknown: true,
    abortEarly: false,
  });
  if (result.error) {
    throw new Error(`Invalid environment configuration: ${result.error.message}`);
  }
  return result.value;
}
