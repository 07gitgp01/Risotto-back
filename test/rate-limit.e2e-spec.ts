import { Controller, Get, INestApplication } from '@nestjs/common';
import { Public } from '../src/common/auth/auth.decorators';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './utils/create-test-app';

@Public()
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
  const previousAuthLimit = process.env.THROTTLE_AUTH_LIMIT;

  beforeAll(async () => {
    process.env.THROTTLE_LIMIT = '3';
    process.env.THROTTLE_AUTH_LIMIT = '2';
    ({ app } = await createTestApp([ThrottledProbeController]));
  });

  afterAll(async () => {
    process.env.THROTTLE_LIMIT = previousLimit;
    process.env.THROTTLE_AUTH_LIMIT = previousAuthLimit;
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

  it('applies the stricter auth limit to /auth routes', async () => {
    const server = app.getHttpServer();
    const credentials = { email: 'nobody@example.com', password: 'wrong-password-1' };
    for (let i = 0; i < 2; i++) {
      await request(server).post('/api/auth/login').send(credentials).expect(401);
    }
    // The global limit (3) is not reached yet: this 429 comes from the auth throttler.
    await request(server).post('/api/auth/login').send(credentials).expect(429);
  });
});
