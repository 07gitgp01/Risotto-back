import * as Joi from 'joi';

export const envValidationSchema = Joi.object<Record<string, unknown>>({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  CORS_ORIGINS: Joi.string().allow('').default(''),

  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(5432),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),

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

  SMTP_HOST: Joi.string().required(),
  SMTP_PORT: Joi.number().port().default(1025),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASSWORD: Joi.string().allow('').default(''),
  MAIL_FROM: Joi.string().default('Risotto <no-reply@risotto.local>'),
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
