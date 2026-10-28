import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';
import request from 'supertest';
import { App } from 'supertest/types';
import { REDIS_CLIENT } from '../src/common/redis/redis.constants';
import { bearer, registerUser, RegisteredUser } from './utils/auth-helpers';
import { createTestApp, resetDatabase } from './utils/create-test-app';
import { FakeMailService } from './utils/fake-mail.service';

/** Hardening added in the final security review. */
describe('Security hardening (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let mail: FakeMailService;
  let alice: RegisteredUser;

  beforeAll(async () => {
    ({ app, mail } = await createTestApp());
    server = app.getHttpServer();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    await app.get<Redis>(REDIS_CLIENT).flushdb();
    mail.clear();
    alice = await registerUser(app, 'alice@example.com');
  });

  afterAll(async () => {
    await app.close();
  });

  const me = (token: string) => request(server).get('/api/users/me').set(bearer(token));

  const login = (email: string, password: string) =>
    request(server).post('/api/auth/login').send({ email, password });

  describe('access tokens are revoked immediately', () => {
    it('after logging out of this session (other sessions keep working)', async () => {
      const otherDevice = await login(alice.email, alice.password).expect(200);
      await me(alice.accessToken).expect(200);

      await request(server)
        .post('/api/auth/logout')
        .set(bearer(alice.accessToken))
        .send({ refreshToken: alice.refreshToken })
        .expect(204);

      await me(alice.accessToken).expect(401);
      await me(otherDevice.body.accessToken as string).expect(200);
    });

    it('after logging out everywhere, but a new login works at once', async () => {
      const otherDevice = await login(alice.email, alice.password).expect(200);
      await request(server).post('/api/auth/logout-all').set(bearer(alice.accessToken)).expect(204);

      await me(alice.accessToken).expect(401);
      await me(otherDevice.body.accessToken as string).expect(401);
      const fresh = await login(alice.email, alice.password).expect(200);
      await me(fresh.body.accessToken as string).expect(200);
    });

    it('after a password reset', async () => {
      await request(server)
        .post('/api/auth/forgot-password')
        .send({ email: alice.email })
        .expect(204);
      await request(server)
        .post('/api/auth/reset-password')
        .send({
          email: alice.email,
          code: mail.lastResetCode(alice.email),
          newPassword: 'nouveau-2027',
        })
        .expect(204);
      await me(alice.accessToken).expect(401);
    });

    it('when a stolen refresh token is replayed', async () => {
      const rotated = await request(server)
        .post('/api/auth/refresh')
        .send({ refreshToken: alice.refreshToken })
        .expect(200);
      await me(rotated.body.accessToken as string).expect(200);

      // Replay of the consumed token: the whole session is cut, access token included.
      await request(server)
        .post('/api/auth/refresh')
        .send({ refreshToken: alice.refreshToken })
        .expect(401);
      await me(rotated.body.accessToken as string).expect(401);
    });

    it('still checks revocations when Redis lost its cache', async () => {
      await request(server).post('/api/auth/logout-all').set(bearer(alice.accessToken)).expect(204);
      await app.get<Redis>(REDIS_CLIENT).flushdb();
      await me(alice.accessToken).expect(401);
    });

    it('refuses a well-signed token without session claim', async () => {
      const legacy = new JwtService({ secret: process.env.JWT_ACCESS_SECRET }).sign({
        sub: alice.id,
      });
      await me(legacy).expect(401);
    });
  });

  describe('per-account login lock', () => {
    it('locks the account after 10 failures, whatever the password', async () => {
      for (let i = 0; i < 10; i++) {
        await login(alice.email, 'wrong-password-1').expect(401);
      }
      await login(alice.email, alice.password).expect(429);
    });

    it('applies to unknown emails the same way (no enumeration)', async () => {
      for (let i = 0; i < 10; i++) {
        await login('ghost@example.com', 'wrong-password-1').expect(401);
      }
      await login('ghost@example.com', 'wrong-password-1').expect(429);
    });

    it('a successful login resets the counter', async () => {
      for (let i = 0; i < 9; i++) {
        await login(alice.email, 'wrong-password-1').expect(401);
      }
      await login(alice.email, alice.password).expect(200);
      for (let i = 0; i < 9; i++) {
        await login(alice.email, 'wrong-password-1').expect(401);
      }
      await login(alice.email, alice.password).expect(200);
    });

    it('does not lock other accounts', async () => {
      const bob = await registerUser(app, 'bob@example.com');
      for (let i = 0; i < 10; i++) {
        await login(alice.email, 'wrong-password-1').expect(401);
      }
      await login(bob.email, bob.password).expect(200);
    });
  });

  describe('HTTP surface', () => {
    it('rejects oversized JSON bodies', async () => {
      await request(server)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(200_000) }))
        .expect(413);
    });

    it('never echoes internal details in errors', async () => {
      const res = await request(server)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": not json')
        .expect(400);
      expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js|node_modules|SyntaxError/);
    });
  });
});
