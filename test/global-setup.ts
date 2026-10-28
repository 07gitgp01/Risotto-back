import { DataSource } from 'typeorm';
import configuration from '../src/config/configuration';
import { validateEnv } from '../src/config/env.validation';
import { buildDataSourceOptions } from '../src/database/typeorm-options';
import { applyTestEnv } from './setup-env';

/** Brings the test database schema up to date before the e2e suites run. */
export default async function globalSetup(): Promise<void> {
  applyTestEnv();
  validateEnv(process.env);
  const dataSource = new DataSource(buildDataSourceOptions(configuration().db));
  await dataSource.initialize();
  await dataSource.runMigrations({ transaction: 'each' });
  await dataSource.destroy();
}
