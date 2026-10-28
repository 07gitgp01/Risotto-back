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
