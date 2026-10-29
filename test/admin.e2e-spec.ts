import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { REDIS_CLIENT } from '../src/common/redis/redis.constants';
import { bearer, registerUser, RegisteredUser } from './utils/auth-helpers';
import { createTestApp, resetDatabase } from './utils/create-test-app';
import { createProfile } from './utils/profile-helpers';

describe('Administration (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let admin: RegisteredUser;
  let alice: RegisteredUser;
  let bob: RegisteredUser;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    server = app.getHttpServer();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    await app.get<Redis>(REDIS_CLIENT).flushdb();
    admin = await registerUser(app, 'admin@example.com');
    alice = await registerUser(app, 'alice@example.com');
    bob = await registerUser(app, 'bob@example.com');
    await setRole(admin, 'admin');
    await createProfile(app, alice, {
      firstName: 'Alice',
      lastName: 'Martin',
      visibility: 'public',
    });
    await createProfile(app, bob, { firstName: 'Bob', lastName: 'Durand', visibility: 'public' });
  });

  afterAll(async () => {
    await app.close();
  });

  const setRole = (user: RegisteredUser, role: 'admin' | 'member') =>
    app.get(DataSource).query('UPDATE users SET role = $1 WHERE id = $2', [role, user.id]);

  const login = (user: RegisteredUser) =>
    request(server).post('/api/auth/login').send({ email: user.email, password: user.password });

  const ENDPOINTS: { method: 'get' | 'post'; path: () => string }[] = [
    { method: 'get', path: () => '/api/admin/stats' },
    { method: 'get', path: () => '/api/admin/users' },
    { method: 'post', path: () => `/api/admin/users/${bob.id}/suspend` },
    { method: 'post', path: () => `/api/admin/users/${bob.id}/reactivate` },
  ];

  describe.each(ENDPOINTS)('$method $path', ({ method, path }) => {
    it('requires authentication', async () => {
      await request(server)[method](path()).expect(401);
    });

    it('is refused to a member', async () => {
      await request(server)[method](path()).set(bearer(alice.accessToken)).expect(403);
    });
  });

  it('exposes the role on the current user', async () => {
    const me = await request(server)
      .get('/api/users/me')
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(me.body.role).toBe('admin');
    const member = await request(server)
      .get('/api/users/me')
      .set(bearer(alice.accessToken))
      .expect(200);
    expect(member.body.role).toBe('member');
  });

  it('reads the role from the database on every request', async () => {
    await request(server).get('/api/admin/stats').set(bearer(admin.accessToken)).expect(200);
    await setRole(admin, 'member');
    await request(server).get('/api/admin/stats').set(bearer(admin.accessToken)).expect(403);
  });

  it('cannot be granted through the API', async () => {
    await request(server)
      .patch('/api/profiles/me')
      .set(bearer(alice.accessToken))
      .send({ role: 'admin' })
      .expect(400);
    const me = await request(server)
      .get('/api/users/me')
      .set(bearer(alice.accessToken))
      .expect(200);
    expect(me.body.role).toBe('member');
  });

  it('returns platform statistics', async () => {
    await request(server)
      .post('/api/connections')
      .set(bearer(bob.accessToken))
      .send({ userId: alice.id })
      .expect(201);
    const stats = await request(server)
      .get('/api/admin/stats')
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(stats.body).toEqual({
      members: { total: 3, suspended: 0, newLast7Days: 3, withProfile: 2 },
      connections: { accepted: 0, pending: 1 },
      messaging: { conversations: 0, messagesLast7Days: 0 },
    });
  });

  describe('account list', () => {
    const list = (query: Record<string, string | number> = {}) =>
      request(server).get('/api/admin/users').query(query).set(bearer(admin.accessToken));

    it('lists every account, newest first, without secrets', async () => {
      const res = await list().expect(200);
      expect(res.body.total).toBe(3);
      const items = res.body.items as { email: string }[];
      expect(items.map((a) => a.email)).toEqual([
        'bob@example.com',
        'alice@example.com',
        'admin@example.com',
      ]);
      expect(res.body.items[0]).toEqual({
        id: bob.id,
        email: 'bob@example.com',
        role: 'member',
        name: 'Bob Durand',
        createdAt: expect.any(String),
        suspendedAt: null,
      });
      expect(res.body.items[2].name).toBeNull();
    });

    it('searches by email or name, ignoring accents and case', async () => {
      expect((await list({ q: 'DURAND' }).expect(200)).body.items).toHaveLength(1);
      expect((await list({ q: 'alice@' }).expect(200)).body.items[0].id).toBe(alice.id);
      expect((await list({ q: 'zzz' }).expect(200)).body).toEqual({ total: 0, items: [] });
      // LIKE wildcards are matched literally.
      expect((await list({ q: '%' }).expect(200)).body.total).toBe(0);
    });

    it('filters by status and paginates', async () => {
      await request(server)
        .post(`/api/admin/users/${bob.id}/suspend`)
        .set(bearer(admin.accessToken))
        .expect(204);
      expect((await list({ status: 'suspended' }).expect(200)).body.items[0].id).toBe(bob.id);
      expect((await list({ status: 'active' }).expect(200)).body.total).toBe(2);
      const page = await list({ limit: 1, offset: 1 }).expect(200);
      expect(page.body.total).toBe(3);
      expect(page.body.items[0].id).toBe(alice.id);
    });

    it('validates the query', async () => {
      await list({ limit: 500 }).expect(400);
      await list({ status: 'deleted' }).expect(400);
    });
  });

  describe('suspension', () => {
    const suspend = (id: string, token = admin.accessToken) =>
      request(server).post(`/api/admin/users/${id}/suspend`).set(bearer(token));

    it('ends every session and blocks sign-in until reactivated', async () => {
      await suspend(bob.id).expect(204);

      await request(server).get('/api/users/me').set(bearer(bob.accessToken)).expect(401);
      await request(server)
        .post('/api/auth/refresh')
        .send({ refreshToken: bob.refreshToken })
        .expect(401);
      const refused = await login(bob).expect(403);
      expect(refused.body.message).toBe('Account suspended');

      await request(server)
        .post(`/api/admin/users/${bob.id}/reactivate`)
        .set(bearer(admin.accessToken))
        .expect(204);
      await login(bob).expect(200);
    });

    it('does not reveal the suspension without the right password', async () => {
      await suspend(bob.id).expect(204);
      await request(server)
        .post('/api/auth/login')
        .send({ email: bob.email, password: 'wrong-password-1' })
        .expect(401);
    });

    it('hides a suspended member from search', async () => {
      const search = () =>
        request(server).get('/api/users/search').query({ q: 'bob' }).set(bearer(alice.accessToken));
      expect((await search().expect(200)).body).toHaveLength(1);
      await suspend(bob.id).expect(204);
      expect((await search().expect(200)).body).toHaveLength(0);
    });

    it('refuses to suspend oneself or another admin', async () => {
      await suspend(admin.id).expect(400);
      await setRole(alice, 'admin');
      await suspend(alice.id).expect(403);
    });

    it('answers 404 for an unknown account and 400 for a malformed id', async () => {
      await suspend('00000000-0000-4000-8000-000000000000').expect(404);
      await suspend('not-a-uuid').expect(400);
    });
  });
});
