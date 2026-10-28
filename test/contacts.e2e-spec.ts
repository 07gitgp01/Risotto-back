import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import request from 'supertest';
import { App } from 'supertest/types';
import { REDIS_CLIENT } from '../src/common/redis/redis.constants';
import { bearer, registerUser, RegisteredUser } from './utils/auth-helpers';
import { createTestApp, resetDatabase } from './utils/create-test-app';
import { createProfile, sampleImage } from './utils/profile-helpers';

describe('QR codes and contacts (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let alice: RegisteredUser;
  let bob: RegisteredUser;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    server = app.getHttpServer();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    // The scan route has its own rate limit.
    await app.get<Redis>(REDIS_CLIENT).flushdb();
    alice = await registerUser(app, 'alice@example.com');
    bob = await registerUser(app, 'bob@example.com');
    await createProfile(app, alice, {
      headline: 'Cheffe de projet',
      company: 'Risotto SAS',
      bio: 'Not part of the card',
      phone: '+33612345678',
      visibility: 'private',
      shareEmail: true,
    });
    await createProfile(app, bob, { firstName: 'Bob', lastName: 'Durand' });
  });

  afterAll(async () => {
    await app.close();
  });

  async function qrOf(user: RegisteredUser): Promise<{ token: string; payload: string }> {
    const res = await request(server).get('/api/qr/me').set(bearer(user.accessToken)).expect(200);
    return res.body as { token: string; payload: string };
  }

  function scan(user: RegisteredUser, payload: string, saveContact?: boolean) {
    return request(server)
      .post('/api/qr/scan')
      .set(bearer(user.accessToken))
      .send({ payload, ...(saveContact === undefined ? {} : { saveContact }) });
  }

  describe('authentication is required on every route', () => {
    it.each([
      ['get', '/api/qr/me'],
      ['post', '/api/qr/me/rotate'],
      ['post', '/api/qr/scan'],
      ['get', '/api/contacts/card/me'],
      ['get', '/api/contacts'],
      ['patch', `/api/contacts/${randomUUID()}`],
      ['delete', `/api/contacts/${randomUUID()}`],
    ] as const)('%s %s → 401', async (method, path) => {
      await request(server)[method](path).expect(401);
    });
  });

  describe('personal QR code', () => {
    it('is a stable random token, never the user id', async () => {
      const first = await qrOf(alice);
      const second = await qrOf(alice);
      expect(first).toEqual(second);
      expect(first.payload).toBe(`risotto://u/${first.token}`);
      expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(first.payload).not.toContain(alice.id);
    });

    it('rotation invalidates the previous code', async () => {
      const old = await qrOf(alice);
      const rotated = await request(server)
        .post('/api/qr/me/rotate')
        .set(bearer(alice.accessToken))
        .expect(200);
      expect(rotated.body.token).not.toBe(old.token);
      await scan(bob, old.payload).expect(404);
      await scan(bob, rotated.body.payload as string).expect(200);
    });
  });

  describe('scan', () => {
    it('reveals the contact card, even for a private profile', async () => {
      const res = await scan(bob, (await qrOf(alice)).payload).expect(200);
      expect(res.body).toEqual({
        isSelf: false,
        saved: false,
        connection: { status: 'none', connectionId: null },
        card: {
          userId: alice.id,
          firstName: 'Alice',
          lastName: 'Martin',
          headline: 'Cheffe de projet',
          jobTitle: null,
          company: 'Risotto SAS',
          location: null,
          website: null,
          email: 'alice@example.com',
          // Not shared by Alice.
          phone: null,
          photoUrl: null,
        },
      });
      expect(JSON.stringify(res.body)).not.toContain('Not part of the card');
    });

    it('accepts the bare token as well', async () => {
      await scan(bob, (await qrOf(alice)).token).expect(200);
    });

    it('saves the contact once, idempotently', async () => {
      const { payload } = await qrOf(alice);
      const first = await scan(bob, payload, true).expect(200);
      const again = await scan(bob, payload, true).expect(200);
      expect(first.body.saved).toBe(true);
      expect(again.body.saved).toBe(true);

      const list = await request(server)
        .get('/api/contacts')
        .set(bearer(bob.accessToken))
        .expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].card.userId).toBe(alice.id);
    });

    it('scanning oneself is allowed but cannot be saved', async () => {
      const { payload } = await qrOf(alice);
      const res = await scan(alice, payload).expect(200);
      expect(res.body.isSelf).toBe(true);
      await scan(alice, payload, true).expect(400);
    });

    it.each([
      ['an unknown token', `risotto://u/${'a'.repeat(43)}`],
      ['a foreign QR code', 'https://example.com/promo'],
      ['an empty-ish payload', 'risotto://u/'],
    ])('answers 404 for %s', async (_label, payload) => {
      await scan(bob, payload).expect(404);
    });

    it('validates the body', async () => {
      await request(server)
        .post('/api/qr/scan')
        .set(bearer(bob.accessToken))
        .send({ payload: 'x'.repeat(129) })
        .expect(400);
      await request(server)
        .post('/api/qr/scan')
        .set(bearer(bob.accessToken))
        .send({ payload: 'x', userId: alice.id })
        .expect(400);
    });

    it('is a 404 when the QR owner has no profile yet', async () => {
      const carol = await registerUser(app);
      await scan(bob, (await qrOf(carol)).payload).expect(404);
    });
  });

  describe('own card', () => {
    it('shows what others get when scanning', async () => {
      const res = await request(server)
        .get('/api/contacts/card/me')
        .set(bearer(alice.accessToken))
        .expect(200);
      expect(res.body).toMatchObject({ userId: alice.id, email: 'alice@example.com', phone: null });
    });

    it('is 404 without a profile', async () => {
      const carol = await registerUser(app);
      await request(server).get('/api/contacts/card/me').set(bearer(carol.accessToken)).expect(404);
    });
  });

  describe('saved contacts', () => {
    beforeEach(async () => {
      await scan(bob, (await qrOf(alice)).payload, true).expect(200);
    });

    it('lists only my own contacts', async () => {
      const aliceList = await request(server)
        .get('/api/contacts')
        .set(bearer(alice.accessToken))
        .expect(200);
      expect(aliceList.body).toEqual([]);
    });

    it('the card stays up to date with the profile', async () => {
      await request(server)
        .patch('/api/profiles/me')
        .set(bearer(alice.accessToken))
        .send({ headline: 'CTO' })
        .expect(200);
      const list = await request(server)
        .get('/api/contacts')
        .set(bearer(bob.accessToken))
        .expect(200);
      expect(list.body[0].card.headline).toBe('CTO');
    });

    it('a private note can be set and cleared', async () => {
      await request(server)
        .patch(`/api/contacts/${alice.id}`)
        .set(bearer(bob.accessToken))
        .send({ note: ' Rencontrée au salon VivaTech ' })
        .expect(204);
      let list = await request(server).get('/api/contacts').set(bearer(bob.accessToken));
      expect(list.body[0].note).toBe('Rencontrée au salon VivaTech');

      await request(server)
        .patch(`/api/contacts/${alice.id}`)
        .set(bearer(bob.accessToken))
        .send({ note: '' })
        .expect(204);
      list = await request(server).get('/api/contacts').set(bearer(bob.accessToken));
      expect(list.body[0].note).toBeNull();
    });

    it("cannot edit or delete a contact that is not in one's list", async () => {
      await request(server)
        .patch(`/api/contacts/${bob.id}`)
        .set(bearer(alice.accessToken))
        .send({ note: 'x' })
        .expect(404);
      await request(server)
        .delete(`/api/contacts/${alice.id}`)
        .set(bearer(alice.accessToken))
        .expect(404);
    });

    it('rejects a too long note', async () => {
      await request(server)
        .patch(`/api/contacts/${alice.id}`)
        .set(bearer(bob.accessToken))
        .send({ note: 'x'.repeat(501) })
        .expect(400);
    });

    it('deletes a contact', async () => {
      await request(server)
        .delete(`/api/contacts/${alice.id}`)
        .set(bearer(bob.accessToken))
        .expect(204);
      const list = await request(server).get('/api/contacts').set(bearer(bob.accessToken));
      expect(list.body).toEqual([]);
    });

    it("a saved card unlocks the photo of a private profile, others still can't see it", async () => {
      await request(server)
        .put('/api/profiles/me/photo')
        .set(bearer(alice.accessToken))
        .attach('photo', await sampleImage(), 'a.png')
        .expect(200);
      const carol = await registerUser(app);

      await request(server)
        .get(`/api/profiles/${alice.id}/photo`)
        .set(bearer(bob.accessToken))
        .expect(200);
      await request(server)
        .get(`/api/profiles/${alice.id}/photo`)
        .set(bearer(carol.accessToken))
        .expect(404);
    });
  });
});
