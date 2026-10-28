import { DataSourceOptions } from 'typeorm';
import { AppConfig } from '../config/configuration';

// TypeORM globs need forward slashes, including on Windows.
const root = `${__dirname}/..`.replace(/\\/g, '/');

/** Shared by the Nest app and the TypeORM CLI. Schema changes go through migrations only. */
export function buildDataSourceOptions(db: AppConfig['db']): DataSourceOptions {
  return {
    type: 'postgres',
    host: db.host,
    port: db.port,
    username: db.user,
    password: db.password,
    database: db.name,
    entities: [`${root}/**/*.entity.{ts,js}`],
    migrations: [`${root}/database/migrations/*.{ts,js}`],
    synchronize: false,
    migrationsRun: false,
  };
}
