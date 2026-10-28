import { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import Redis from 'ioredis';
import { AppModule } from '../../src/app.module';
import { REDIS_CLIENT } from '../../src/common/redis/redis.constants';
import { setupApp } from '../../src/setup-app';

/**
 * Boots the real application (real PostgreSQL + Redis) with the production HTTP setup.
 * `extraControllers` lets a suite mount test-only routes.
 */
export async function createTestApp(
  extraControllers: Type<unknown>[] = [],
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: extraControllers,
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  setupApp(app);
  await app.init();
  // Rate-limit counters must not leak between suites.
  await app.get<Redis>(REDIS_CLIENT).flushdb();
  return app;
}
