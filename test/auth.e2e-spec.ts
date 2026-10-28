import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp, resetDatabase } from './utils/create-test-app';
import { bearer, registerUser, uniqueEmail, VALID_PASSWORD } from './utils/auth-helpers';
import { FakeMailService } from './utils/fake-mail.service';

describe('Authentication (e2e)', () => {
  let app: INestApplication<App>;
  let mail: FakeMailService;
  let server: App;

  beforeAll(async () => {
    ({ app, mail } = await createTestApp());
    server = app.getHttpServer();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    mail.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/auth/register', () => {
    it('creates the account and opens a session', async () => {
      const res = await request(server)
        .post('/api/auth/register')
        .send({ email: '  Alice@Example.COM ', password: VALID_PASSWORD })
        .expect(201);

      expect(res.body).toEqual({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        tokenType: 'Bearer',
        expiresIn: 900,
        user: { id: expect.any(String), email: 'alice@example.com', createdAt: expect.any(String) },
      });
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    });

    it('stores an argon2id hash, never the password', async () => {
      const user = await registerUser(app);
      const [row] = await app
        .get(DataSource)
        .query<{ password_hash: string }[]>('SELECT password_hash FROM users WHERE id = $1', [
          user.id,
        ]);
      expect(row.password_hash).toMatch(/^\$argon2id\$/);
      expect(row.password_hash).not.toContain(VALID_PASSWORD);
    });

    it('rejects an email already registered, whatever its case', async () => {
      await registerUser(app, 'bob@example.com');
      await request(server)
        .post('/api/auth/register')
        .send({ email: 'BOB@example.com', password: VALID_PASSWORD })
        .expect(409);
    });

    it.each([
      ['an invalid email', { email: 'not-an-email', password: VALID_PASSWORD }],
      ['a short password', { email: 'c@example.com', password: 'abc123' }],
      ['a password without digit', { email: 'c@example.com', password: 'only-letters' }],
      ['a password without letter', { email: 'c@example.com', password: '1234567890' }],
      ['a too long password', { email: 'c@example.com', password: `a1${'x'.repeat(127)}` }],
      ['unknown properties', { email: 'c@example.com', password: VALID_PASSWORD, role: 'admin' }],
      ['a missing body', {}],
    ])('rejects %s with 400', async (_label, body) => {
      await request(server).post('/api/auth/register').send(body).expect(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('opens a session with valid credentials (email case-insensitive)', async () => {
      const user = await registerUser(app, 'carol@example.com');
      const res = await request(server)
        .post('/api/auth/login')
        .send({ email: 'Carol@Example.com', password: user.password })
        .expect(200);
      expect(res.body.user.id).toBe(user.id);
      expect(res.body.refreshToken).not.toBe(user.refreshToken);
    });

    it('answers the same 401 for a wrong password and an unknown email', async () => {
      const user = await registerUser(app);
      const wrongPassword = await request(server)
        .post('/api/auth/login')
        .send({ email: user.email, password: 'wrong-password-1' })
        .expect(401);
      const unknownEmail = await request(server)
        .post('/api/auth/login')
        .send({ email: uniqueEmail(), password: 'wrong-password-1' })
        .expect(401);
      expect(wrongPassword.body).toEqual(unknownEmail.body);
    });
  });

  describe('access token', () => {
    it('GET /api/users/me returns the current user', async () => {
      const user = await registerUser(app);
      const res = await request(server).get('/api/users/me').set(bearer(user.accessToken));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: user.id, email: user.email, createdAt: expect.any(String) });
    });

    it('GET /api/users/me requires a token', async () => {
      await request(server).get('/api/users/me').expect(401);
    });

    it.each([
      ['a malformed token', 'Bearer not-a-jwt'],
      ['another scheme', 'Basic abc'],
      ['an empty bearer', 'Bearer '],
    ])('rejects %s', async (_label, header) => {
      await request(server).get('/api/users/me').set('Authorization', header).expect(401);
    });

    it('rejects a token signed with another secret', async () => {
      const user = await registerUser(app);
      const forged = new JwtService({ secret: 'x'.repeat(48) }).sign({ sub: user.id });
      await request(server).get('/api/users/me').set(bearer(forged)).expect(401);
    });

    it('rejects an expired token', async () => {
      const user = await registerUser(app);
      const expired = new JwtService({ secret: process.env.JWT_ACCESS_SECRET }).sign(
        { sub: user.id, exp: Math.floor(Date.now() / 1000) - 10 },
        { noTimestamp: true },
      );
      await request(server).get('/api/users/me').set(bearer(expired)).expect(401);
    });

    it('rejects the "none" algorithm', async () => {
      const user = await registerUser(app);
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ sub: user.id })).toString('base64url');
      await request(server)
        .get('/api/users/me')
        .set(bearer(`${header}.${payload}.`))
        .expect(401);
    });

    it('a refresh token is not accepted as an access token', async () => {
      const user = await registerUser(app);
      await request(server).get('/api/users/me').set(bearer(user.refreshToken)).expect(401);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('rotates the refresh token', async () => {
      const user = await registerUser(app);
      const res = await request(server)
        .post('/api/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(200);
      expect(res.body).toEqual({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        tokenType: 'Bearer',
        expiresIn: 900,
      });
      expect(res.body.refreshToken).not.toBe(user.refreshToken);
      await request(server)
        .get('/api/users/me')
        .set(bearer(res.body.accessToken as string))
        .expect(200);
    });

    it('detects reuse and revokes the whole session', async () => {
      const user = await registerUser(app);
      const first = await request(server)
        .post('/api/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(200);

      // An attacker replays the old token.
      await request(server)
        .post('/api/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(401);

      // The legitimate, newer token of the same family is revoked too.
      await request(server)
        .post('/api/auth/refresh')
        .send({ refreshToken: first.body.refreshToken })
        .expect(401);
    });

    it('reuse in one session does not affect the other sessions', async () => {
      const user = await registerUser(app);
      const other = await request(server)
        .post('/api/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);

      await request(server).post('/api/auth/refresh').send({ refreshToken: user.refreshToken });
      await request(server)
        .post('/api/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(401);

      await request(server)
        .post('/api/auth/refresh')
        .send({ refreshToken: other.body.refreshToken })
        .expect(200);
    });

    it('accepts a refresh token only once under concurrent requests', async () => {
      const user = await registerUser(app);
      const results = await Promise.all(
        [1, 2, 3].map(() =>
          request(server).post('/api/auth/refresh').send({ refreshToken: user.refreshToken }),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    });

    it('rejects an unknown token', async () => {
      await request(server)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'unknown-token' })
        .expect(401);
    });

    it('rejects an expired token', async () => {
      const user = await registerUser(app);
      await app
        .get(DataSource)
        .query(`UPDATE refresh_tokens SET expires_at = now() - interval '1 second'`);
      await request(server)
        .post('/api/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(401);
    });

    it('stores only a hash of the refresh token', async () => {
      const user = await registerUser(app);
      const rows = await app
        .get(DataSource)
        .query<{ token_hash: string }[]>('SELECT token_hash FROM refresh_tokens');
      expect(rows).toHaveLength(1);
      expect(rows[0].token_hash).not.toBe(user.refreshToken);
      expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('requires authentication', async () => {
      const user = await registerUser(app);
      await request(server)
        .post('/api/auth/logout')
        .send({ refreshToken: user.refreshToken })
        .expect(401);
    });

    it('revokes the current session', async () => {
      const user = await registerUser(app);
      await request(server)
        .post('/api/auth/logout')
        .set(bearer(user.accessToken))
        .send({ refreshToken: user.refreshToken })
        .expect(204);
      await request(server)
        .post('/api/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(401);
    });

    it("cannot revoke another user's session", async () => {
      const alice = await registerUser(app);
      const mallory = await registerUser(app);
      await request(server)
        .post('/api/auth/logout')
        .set(bearer(mallory.accessToken))
        .send({ refreshToken: alice.refreshToken })
        .expect(204);
      await request(server)
        .post('/api/auth/refresh')
        .send({ refreshToken: alice.refreshToken })
        .expect(200);
    });
  });

  describe('POST /api/auth/logout-all', () => {
    it('requires authentication', async () => {
      await request(server).post('/api/auth/logout-all').expect(401);
    });

    it('revokes every session of the current user only', async () => {
      const alice = await registerUser(app);
      const aliceOtherDevice = await request(server)
        .post('/api/auth/login')
        .send({ email: alice.email, password: alice.password })
        .expect(200);
      const bob = await registerUser(app);

      await request(server).post('/api/auth/logout-all').set(bearer(alice.accessToken)).expect(204);

      for (const token of [alice.refreshToken, aliceOtherDevice.body.refreshToken as string]) {
        await request(server).post('/api/auth/refresh').send({ refreshToken: token }).expect(401);
      }
      await request(server)
        .post('/api/auth/refresh')
        .send({ refreshToken: bob.refreshToken })
        .expect(200);
    });
  });

  describe('password reset', () => {
    const NEW_PASSWORD = 'new-risotto-2027';

    async function requestCode(email: string): Promise<string> {
      await request(server).post('/api/auth/forgot-password').send({ email }).expect(204);
      const code = mail.lastResetCode(email);
      expect(code).toMatch(/^\d{6}$/);
      return code as string;
    }

    it('answers 204 for an unknown email without sending anything', async () => {
      await request(server)
        .post('/api/auth/forgot-password')
        .send({ email: uniqueEmail() })
        .expect(204);
      expect(mail.outbox).toHaveLength(0);
    });

    it('emails a code and stores only its HMAC', async () => {
      const user = await registerUser(app);
      const code = await requestCode(user.email);
      const rows = await app
        .get(DataSource)
        .query<{ code_hash: string }[]>('SELECT code_hash FROM password_reset_codes');
      expect(rows).toHaveLength(1);
      expect(rows[0].code_hash).not.toContain(code);
    });

    it('resets the password, signs out every session, accepts the new password', async () => {
      const user = await registerUser(app);
      const code = await requestCode(user.email);

      await request(server)
        .post('/api/auth/reset-password')
        .send({ email: user.email, code, newPassword: NEW_PASSWORD })
        .expect(204);

      await request(server)
        .post('/api/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(401);
      await request(server)
        .post('/api/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(401);
      await request(server)
        .post('/api/auth/login')
        .send({ email: user.email, password: NEW_PASSWORD })
        .expect(200);
    });

    it('a code works only once', async () => {
      const user = await registerUser(app);
      const code = await requestCode(user.email);
      await request(server)
        .post('/api/auth/reset-password')
        .send({ email: user.email, code, newPassword: NEW_PASSWORD })
        .expect(204);
      await request(server)
        .post('/api/auth/reset-password')
        .send({ email: user.email, code, newPassword: 'another-pass-3' })
        .expect(400);
    });

    it('only the latest code is valid', async () => {
      const user = await registerUser(app);
      const first = await requestCode(user.email);
      const second = await requestCode(user.email);
      if (first !== second) {
        await request(server)
          .post('/api/auth/reset-password')
          .send({ email: user.email, code: first, newPassword: NEW_PASSWORD })
          .expect(400);
      }
      await request(server)
        .post('/api/auth/reset-password')
        .send({ email: user.email, code: second, newPassword: NEW_PASSWORD })
        .expect(204);
    });

    it("a code cannot reset another user's password", async () => {
      const alice = await registerUser(app);
      const mallory = await registerUser(app);
      const malloryCode = await requestCode(mallory.email);
      await request(server)
        .post('/api/auth/reset-password')
        .send({ email: alice.email, code: malloryCode, newPassword: NEW_PASSWORD })
        .expect(400);
    });

    it('invalidates the code after 5 wrong attempts', async () => {
      const user = await registerUser(app);
      const code = await requestCode(user.email);
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) {
        await request(server)
          .post('/api/auth/reset-password')
          .send({ email: user.email, code: wrong, newPassword: NEW_PASSWORD })
          .expect(400);
      }
      await request(server)
        .post('/api/auth/reset-password')
        .send({ email: user.email, code, newPassword: NEW_PASSWORD })
        .expect(400);
    });

    it('rejects an expired code', async () => {
      const user = await registerUser(app);
      const code = await requestCode(user.email);
      await app
        .get(DataSource)
        .query(`UPDATE password_reset_codes SET expires_at = now() - interval '1 second'`);
      await request(server)
        .post('/api/auth/reset-password')
        .send({ email: user.email, code, newPassword: NEW_PASSWORD })
        .expect(400);
    });

    it('answers the same 400 for an unknown email', async () => {
      const res = await request(server)
        .post('/api/auth/reset-password')
        .send({ email: uniqueEmail(), code: '123456', newPassword: NEW_PASSWORD })
        .expect(400);
      expect(res.body.message).toBe('Invalid or expired code');
    });

    it.each([
      ['a non numeric code', { code: 'abcdef', newPassword: NEW_PASSWORD }],
      ['a short code', { code: '123', newPassword: NEW_PASSWORD }],
      ['a weak new password', { code: '123456', newPassword: 'weak' }],
    ])('validates %s', async (_label, body) => {
      await request(server)
        .post('/api/auth/reset-password')
        .send({ email: 'a@example.com', ...body })
        .expect(400);
    });
  });
});
