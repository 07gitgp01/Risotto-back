import { Controller, Get, INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './utils/create-test-app';

@Controller('throttled-probe')
class ThrottledProbeController {
  @Get()
  probe(): { ok: true } {
    return { ok: true };
  }
}

describe('Global rate limiting (e2e)', () => {
  let app: INestApplication<App>;
  const previousLimit = process.env.THROTTLE_LIMIT;

  beforeAll(async () => {
    process.env.THROTTLE_LIMIT = '3';
    app = await createTestApp([ThrottledProbeController]);
  });

  afterAll(async () => {
    process.env.THROTTLE_LIMIT = previousLimit;
    await app.close();
  });

  it('applies the global limit to every route by default', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < 3; i++) {
      await request(server).get('/api/throttled-probe').expect(200);
    }
    const res = await request(server).get('/api/throttled-probe').expect(429);
    expect(res.body).toMatchObject({ statusCode: 429 });
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('never throttles the health check', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).get('/api/health').expect(200);
    }
  });
});
