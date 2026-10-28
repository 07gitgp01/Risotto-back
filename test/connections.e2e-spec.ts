import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { REDIS_CLIENT } from '../src/common/redis/redis.constants';
import { bearer, registerUser, RegisteredUser } from './utils/auth-helpers';
import { createTestApp, resetDatabase } from './utils/create-test-app';
import { createProfile } from './utils/profile-helpers';

describe('Connections, blocks and search (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let alice: RegisteredUser;
  let bob: RegisteredUser;
  let carol: RegisteredUser;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    server = app.getHttpServer();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    await app.get<Redis>(REDIS_CLIENT).flushdb();
    alice = await registerUser(app, 'alice@example.com');
    bob = await registerUser(app, 'bob@example.com');
    carol = await registerUser(app, 'carol@example.com');
    await createProfile(app, alice, {
      firstName: 'Alice',
      lastName: 'Martin',
      headline: 'Cheffe de projet',
      company: 'Risotto SAS',
      visibility: 'connections',
    });
    await createProfile(app, bob, {
      firstName: 'Bob',
      lastName: 'Durand',
      company: 'Basilic',
      visibility: 'public',
    });
    await createProfile(app, carol, {
      firstName: 'Élodie',
      lastName: 'Carol',
      visibility: 'private',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const ask = (from: RegisteredUser, body: Record<string, unknown>) =>
    request(server).post('/api/connections').set(bearer(from.accessToken)).send(body);

  const requests = (user: RegisteredUser, direction: 'incoming' | 'outgoing') =>
    request(server)
      .get(`/api/connections/requests?direction=${direction}`)
      .set(bearer(user.accessToken));

  const connectionsOf = (user: RegisteredUser) =>
    request(server).get('/api/connections').set(bearer(user.accessToken));

  async function connect(from: RegisteredUser, to: RegisteredUser): Promise<string> {
    const res = await ask(from, { userId: to.id }).expect(201);
    await request(server)
      .post(`/api/connections/${res.body.id}/accept`)
      .set(bearer(to.accessToken))
      .expect(200);
    return res.body.id as string;
  }

  describe('authentication is required on every route', () => {
    it.each([
      ['get', '/api/users/search?q=al'],
      ['post', '/api/connections'],
      ['get', '/api/connections'],
      ['get', '/api/connections/requests?direction=incoming'],
      ['post', `/api/connections/${randomUUID()}/accept`],
      ['post', `/api/connections/${randomUUID()}/decline`],
      ['delete', `/api/connections/${randomUUID()}`],
      ['post', '/api/blocks'],
      ['get', '/api/blocks'],
      ['delete', `/api/blocks/${randomUUID()}`],
    ] as const)('%s %s → 401', async (method, path) => {
      await request(server)[method](path).expect(401);
    });
  });

  describe('requests', () => {
    it('sends a request with a message, visible on both sides', async () => {
      const res = await ask(alice, { userId: bob.id, message: ' Ravie de vous connaître ' }).expect(
        201,
      );
      expect(res.body).toMatchObject({
        status: 'pending',
        direction: 'outgoing',
        message: 'Ravie de vous connaître',
        user: { userId: bob.id, firstName: 'Bob' },
      });

      const incoming = await requests(bob, 'incoming').expect(200);
      expect(incoming.body).toHaveLength(1);
      expect(incoming.body[0]).toMatchObject({
        id: res.body.id,
        direction: 'incoming',
        user: { userId: alice.id, access: 'preview' },
      });
      const outgoing = await requests(alice, 'outgoing').expect(200);
      expect(outgoing.body).toHaveLength(1);
      expect((await requests(alice, 'incoming')).body).toEqual([]);
    });

    it('accepting connects both users and unlocks the full profile', async () => {
      await connect(alice, bob);
      const aliceProfile = await request(server)
        .get(`/api/profiles/${alice.id}`)
        .set(bearer(bob.accessToken))
        .expect(200);
      expect(aliceProfile.body).toMatchObject({
        access: 'full',
        company: 'Risotto SAS',
        connection: { status: 'connected' },
      });
      expect((await connectionsOf(alice)).body).toHaveLength(1);
      expect((await connectionsOf(bob)).body[0].user.userId).toBe(alice.id);
    });

    it('a request to someone who already asked me accepts it', async () => {
      await ask(alice, { userId: bob.id }).expect(201);
      const res = await ask(bob, { userId: alice.id }).expect(201);
      expect(res.body.status).toBe('accepted');
    });

    it.each([
      ['myself', () => ({ userId: alice.id }), 400],
      ['an unknown user', () => ({ userId: randomUUID() }), 404],
      ['a private profile by id', () => ({ userId: carol.id }), 404],
      ['nobody', () => ({}), 400],
      ['both id and QR', () => ({ userId: bob.id, qrPayload: 'x' }), 400],
      ['a too long message', () => ({ userId: bob.id, message: 'x'.repeat(301) }), 400],
    ])('rejects a request to %s', async (_label, body, status) => {
      await ask(alice, body()).expect(status);
    });

    it('a private profile can be reached through its QR code', async () => {
      const qr = await request(server).get('/api/qr/me').set(bearer(carol.accessToken)).expect(200);
      const res = await ask(alice, { qrPayload: qr.body.payload as string }).expect(201);
      expect(res.body.user).toMatchObject({ userId: carol.id, access: 'minimal' });
    });

    it('requires the requester to have a profile', async () => {
      const dave = await registerUser(app);
      await ask(dave, { userId: bob.id }).expect(400);
    });

    it('duplicates are conflicts', async () => {
      await ask(alice, { userId: bob.id }).expect(201);
      await ask(alice, { userId: bob.id }).expect(409);
      await request(server)
        .post(`/api/connections/${(await requests(bob, 'incoming')).body[0].id}/accept`)
        .set(bearer(bob.accessToken))
        .expect(200);
      await ask(alice, { userId: bob.id }).expect(409);
    });

    it('only the recipient can accept or decline', async () => {
      const { body } = await ask(alice, { userId: bob.id }).expect(201);
      await request(server)
        .post(`/api/connections/${body.id}/accept`)
        .set(bearer(alice.accessToken))
        .expect(403);
      // A third party does not even learn that the request exists.
      await request(server)
        .post(`/api/connections/${body.id}/accept`)
        .set(bearer(carol.accessToken))
        .expect(404);
      await request(server)
        .post(`/api/connections/${body.id}/decline`)
        .set(bearer(carol.accessToken))
        .expect(404);
    });

    it('a declined requester must wait, the other side may ask', async () => {
      const { body } = await ask(alice, { userId: bob.id }).expect(201);
      await request(server)
        .post(`/api/connections/${body.id}/decline`)
        .set(bearer(bob.accessToken))
        .expect(204);
      expect((await requests(bob, 'incoming')).body).toEqual([]);
      await ask(alice, { userId: bob.id }).expect(409);

      // After the cool-down, Alice may ask again.
      await app
        .get(DataSource)
        .query(`UPDATE connections SET responded_at = now() - interval '31 days'`);
      await ask(alice, { userId: bob.id }).expect(201);
    });

    it('the decliner can still send a request later', async () => {
      const { body } = await ask(alice, { userId: bob.id }).expect(201);
      await request(server)
        .post(`/api/connections/${body.id}/decline`)
        .set(bearer(bob.accessToken))
        .expect(204);
      const res = await ask(bob, { userId: alice.id }).expect(201);
      expect(res.body).toMatchObject({ status: 'pending', direction: 'outgoing' });
    });

    it('answering a request twice is a conflict', async () => {
      const id = await connect(alice, bob);
      await request(server)
        .post(`/api/connections/${id}/decline`)
        .set(bearer(bob.accessToken))
        .expect(409);
    });

    it('the requester can cancel; the recipient must decline instead', async () => {
      const { body } = await ask(alice, { userId: bob.id }).expect(201);
      await request(server)
        .delete(`/api/connections/${body.id}`)
        .set(bearer(bob.accessToken))
        .expect(403);
      await request(server)
        .delete(`/api/connections/${body.id}`)
        .set(bearer(alice.accessToken))
        .expect(204);
      expect((await requests(bob, 'incoming')).body).toEqual([]);
    });

    it('either side can remove a connection; others cannot', async () => {
      const id = await connect(alice, bob);
      await request(server)
        .delete(`/api/connections/${id}`)
        .set(bearer(carol.accessToken))
        .expect(404);
      await request(server)
        .delete(`/api/connections/${id}`)
        .set(bearer(bob.accessToken))
        .expect(204);
      expect((await connectionsOf(alice)).body).toEqual([]);
    });

    it('validates query parameters', async () => {
      await request(server)
        .get('/api/connections/requests?direction=sideways')
        .set(bearer(alice.accessToken))
        .expect(400);
      await request(server)
        .get('/api/connections?limit=1000')
        .set(bearer(alice.accessToken))
        .expect(400);
      await request(server)
        .post('/api/connections/not-a-uuid/accept')
        .set(bearer(alice.accessToken))
        .expect(400);
    });
  });

  describe('search', () => {
    const search = (user: RegisteredUser, q: string) =>
      request(server)
        .get(`/api/users/search?q=${encodeURIComponent(q)}`)
        .set(bearer(user.accessToken));

    it('finds members by name, case- and accent-insensitively', async () => {
      const res = await search(alice, 'DURAND').expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        userId: bob.id,
        access: 'full',
        connection: { status: 'none', connectionId: null },
      });
    });

    it('never returns private profiles nor the viewer', async () => {
      expect((await search(bob, 'elodie')).body).toEqual([]);
      expect((await search(alice, 'alice')).body).toEqual([]);
    });

    it('company is searchable only on public profiles', async () => {
      expect((await search(alice, 'basilic')).body).toHaveLength(1);
      // Alice's company is hidden from strangers, so it must not match either.
      expect((await search(bob, 'risotto')).body).toEqual([]);
      expect((await search(bob, 'cheffe')).body).toHaveLength(1);
    });

    it('reports the connection state', async () => {
      await ask(alice, { userId: bob.id }).expect(201);
      const res = await search(alice, 'bob').expect(200);
      expect(res.body[0].connection.status).toBe('pending_outgoing');
      const reverse = await search(bob, 'alice').expect(200);
      expect(reverse.body[0].connection.status).toBe('pending_incoming');
    });

    it('treats LIKE wildcards literally', async () => {
      expect((await search(alice, '%%')).body).toEqual([]);
      expect((await search(alice, '__')).body).toEqual([]);
    });

    it('requires at least 2 characters', async () => {
      await search(alice, 'a').expect(400);
      await request(server).get('/api/users/search').set(bearer(alice.accessToken)).expect(400);
    });
  });

  describe('blocks', () => {
    const block = (from: RegisteredUser, userId: string) =>
      request(server).post('/api/blocks').set(bearer(from.accessToken)).send({ userId });

    it('blocking removes the connection and hides both users from each other', async () => {
      await connect(alice, bob);
      await block(alice, bob.id).expect(204);

      expect((await connectionsOf(alice)).body).toEqual([]);
      expect((await connectionsOf(bob)).body).toEqual([]);
      // Neither sees the other's profile, nor finds them, nor can ask again.
      await request(server)
        .get(`/api/profiles/${alice.id}`)
        .set(bearer(bob.accessToken))
        .expect(404);
      await request(server)
        .get(`/api/profiles/${bob.id}`)
        .set(bearer(alice.accessToken))
        .expect(404);
      expect(
        (await request(server).get('/api/users/search?q=alice').set(bearer(bob.accessToken))).body,
      ).toEqual([]);
      await ask(bob, { userId: alice.id }).expect(404);
    });

    it('blocking also hides the QR code and the saved card', async () => {
      const qr = await request(server).get('/api/qr/me').set(bearer(alice.accessToken));
      await request(server)
        .post('/api/qr/scan')
        .set(bearer(bob.accessToken))
        .send({ payload: qr.body.payload, saveContact: true })
        .expect(200);
      await block(alice, bob.id).expect(204);

      await request(server)
        .post('/api/qr/scan')
        .set(bearer(bob.accessToken))
        .send({ payload: qr.body.payload })
        .expect(404);
      const contacts = await request(server).get('/api/contacts').set(bearer(bob.accessToken));
      expect(contacts.body).toEqual([]);
    });

    it('is idempotent, listable and reversible', async () => {
      await block(alice, bob.id).expect(204);
      await block(alice, bob.id).expect(204);
      const list = await request(server).get('/api/blocks').set(bearer(alice.accessToken));
      expect(list.body).toEqual([
        { userId: bob.id, firstName: 'Bob', lastName: 'Durand', blockedAt: expect.any(String) },
      ]);
      // Bob does not see who blocked him.
      expect((await request(server).get('/api/blocks').set(bearer(bob.accessToken))).body).toEqual(
        [],
      );

      await request(server)
        .delete(`/api/blocks/${bob.id}`)
        .set(bearer(alice.accessToken))
        .expect(204);
      await request(server)
        .get(`/api/profiles/${bob.id}`)
        .set(bearer(alice.accessToken))
        .expect(200);
    });

    it('only the blocker can unblock', async () => {
      await block(alice, bob.id).expect(204);
      await request(server)
        .delete(`/api/blocks/${alice.id}`)
        .set(bearer(bob.accessToken))
        .expect(404);
      await ask(bob, { userId: alice.id }).expect(404);
    });

    it('validates the target', async () => {
      await block(alice, alice.id).expect(400);
      await block(alice, randomUUID()).expect(404);
      await block(alice, 'nope').expect(400);
    });
  });
});
