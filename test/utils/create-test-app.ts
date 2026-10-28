import { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { REDIS_CLIENT } from '../../src/common/redis/redis.constants';
import { MailService } from '../../src/modules/mail/mail.service';
import { setupApp } from '../../src/setup-app';
import { FakeMailService } from './fake-mail.service';

export interface TestApp {
  app: INestApplication;
  mail: FakeMailService;
  /** Base URL when started with `listen: true` (WebSocket tests). */
  url: string | null;
}

/**
 * Boots the real application (real PostgreSQL + Redis) with the production HTTP setup.
 * Only outgoing email is replaced, by an in-memory outbox.
 * `extraControllers` lets a suite mount test-only routes.
 */
export async function createTestApp(
  extraControllers: Type<unknown>[] = [],
  options: { listen?: boolean } = {},
): Promise<TestApp> {
  const mail = new FakeMailService();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: extraControllers,
  })
    .overrideProvider(MailService)
    .useValue(mail)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  setupApp(app);
  let url: string | null = null;
  if (options.listen) {
    await app.listen(0, '127.0.0.1');
    url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  } else {
    await app.init();
  }
  // Rate-limit counters must not leak between suites.
  await app.get<Redis>(REDIS_CLIENT).flushdb();
  return { app, mail, url };
}

/** Empties every application table (keeps the migrations table). */
export async function resetDatabase(app: INestApplication): Promise<void> {
  const dataSource = app.get(DataSource);
  const tables = dataSource.entityMetadatas.map((meta) => `"${meta.tableName}"`).join(', ');
  if (tables) {
    await dataSource.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
  }
}
