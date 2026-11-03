import { DataSourceOptions } from 'typeorm';
import { AppConfig } from '../config/configuration';

// TypeORM globs need forward slashes, including on Windows.
const root = `${__dirname}/..`.replace(/\\/g, '/');

/** Shared by the Nest app and the TypeORM CLI. Schema changes go through migrations only. */
export function buildDataSourceOptions(db: AppConfig['db']): DataSourceOptions {
  return {
    type: 'postgres',
    // gen_random_uuid() is built into PostgreSQL 13+, no uuid-ossp extension needed.
    uuidExtension: 'pgcrypto',
    ...(db.url
      ? { url: db.url }
      : {
          host: db.host,
          port: db.port,
          username: db.user,
          password: db.password,
          database: db.name,
        }),
    // The certificate is always verified: with a private CA (Supabase), pass it in DB_SSL_CA.
    ssl: db.ssl ? (db.sslCa ? { ca: db.sslCa } : true) : false,
    entities: [`${root}/**/*.entity.{ts,js}`],
    migrations: [`${root}/database/migrations/*.{ts,js}`],
    synchronize: false,
    migrationsRun: false,
  };
}
