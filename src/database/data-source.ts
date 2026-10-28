import 'reflect-metadata';
import { existsSync } from 'fs';
import { DataSource } from 'typeorm';
import configuration from '../config/configuration';
import { validateEnv } from '../config/env.validation';
import { buildDataSourceOptions } from './typeorm-options';

// Entry point for the TypeORM CLI (migration:generate / run / revert).
// Real environment variables win over the optional local .env file.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}
validateEnv(process.env);

export default new DataSource(buildDataSourceOptions(configuration().db));
