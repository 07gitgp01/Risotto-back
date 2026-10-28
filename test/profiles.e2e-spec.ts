import { INestApplication } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import sharp from 'sharp';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { bearer, registerUser, RegisteredUser } from './utils/auth-helpers';
import { createTestApp, resetDatabase } from './utils/create-test-app';
import { createProfile, sampleImage } from './utils/profile-helpers';

describe('Profiles (e2e)', () => {
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
    alice = await registerUser(app, 'alice@example.com');
    bob = await registerUser(app, 'bob@example.com');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('authentication is required on every route', () => {
    it.each([
      ['get', '/api/profiles/me'],
      ['post', '/api/profiles/me'],
      ['patch', '/api/profiles/me'],
      ['put', '/api/profiles/me/photo'],
      ['delete', '/api/profiles/me/photo'],
      ['get', `/api/profiles/${randomUUID()}`],
      ['get', `/api/profiles/${randomUUID()}/photo`],
    ] as const)('%s %s → 401', async (method, path) => {
      await request(server)[method](path).expect(401);
    });
  });

  describe('own profile', () => {
    it('GET /profiles/me is 404 until the profile is created', async () => {
      await request(server).get('/api/profiles/me').set(bearer(alice.accessToken)).expect(404);
    });

    it('POST /profiles/me creates it with private-by-default sharing', async () => {
      const profile = await createProfile(app, alice, {
        firstName: '  Alice ',
        headline: 'Cheffe de projet',
      });
      expect(profile).toMatchObject({
        userId: alice.id,
        access: 'full',
        firstName: 'Alice',
        lastName: 'Martin',
        headline: 'Cheffe de projet',
        visibility: 'connections',
        shareEmail: false,
        sharePhone: false,
        accountEmail: 'alice@example.com',
        email: null,
        photoUrl: null,
      });
    });

    it('POST /profiles/me twice is a conflict', async () => {
      await createProfile(app, alice);
      await request(server)
        .post('/api/profiles/me')
        .set(bearer(alice.accessToken))
        .send({ firstName: 'A', lastName: 'B' })
        .expect(409);
    });

    it('PATCH /profiles/me updates fields and clears optional ones with ""', async () => {
      await createProfile(app, alice, { company: 'Risotto SAS', phone: '+33 6 12 34 56 78' });
      const res = await request(server)
        .patch('/api/profiles/me')
        .set(bearer(alice.accessToken))
        .send({
          headline: 'CTO',
          company: '',
          website: 'https://alice.example.com',
          visibility: 'public',
          shareEmail: true,
        })
        .expect(200);
      expect(res.body).toMatchObject({
        headline: 'CTO',
        company: null,
        website: 'https://alice.example.com',
        visibility: 'public',
        shareEmail: true,
        email: 'alice@example.com',
        phone: '+33 6 12 34 56 78',
      });
    });

    it('PATCH before creation is 404', async () => {
      await request(server)
        .patch('/api/profiles/me')
        .set(bearer(alice.accessToken))
        .send({ headline: 'x' })
        .expect(404);
    });

    it.each([
      ['an empty first name', { firstName: '' }],
      ['a null last name', { lastName: null }],
      ['a null visibility', { visibility: null }],
      ['an unknown visibility', { visibility: 'everyone' }],
      ['a too long bio', { bio: 'x'.repeat(1001) }],
      ['an invalid phone', { phone: 'call me' }],
      ['a javascript: website', { website: 'javascript:alert(1)' }],
      ['a website without protocol', { website: 'alice.example.com' }],
      ['a non boolean share flag', { shareEmail: 'yes' }],
      ['an attempt to change the owner', { userId: randomUUID() }],
      ['an attempt to set the photo key', { photoKey: '../../etc/passwd' }],
    ])('PATCH rejects %s with 400', async (_label, body) => {
      await createProfile(app, alice);
      await request(server)
        .patch('/api/profiles/me')
        .set(bearer(alice.accessToken))
        .send(body)
        .expect(400);
    });
  });

  describe("viewing someone else's profile", () => {
    const fullFields = {
      headline: 'Cheffe de projet',
      jobTitle: 'PM',
      company: 'Risotto SAS',
      bio: 'Bio',
      location: 'Lyon',
      website: 'https://alice.example.com',
      phone: '+33612345678',
    };

    async function viewAlice(): Promise<request.Response> {
      return request(server).get(`/api/profiles/${alice.id}`).set(bearer(bob.accessToken));
    }

    it('public: everything except unshared contact details', async () => {
      await createProfile(app, alice, { ...fullFields, visibility: 'public' });
      const res = await viewAlice();
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ access: 'full', company: 'Risotto SAS', bio: 'Bio' });
      expect(res.body.email).toBeNull();
      expect(res.body.phone).toBeNull();
      // Privacy settings are reserved to the owner.
      expect(res.body).not.toHaveProperty('visibility');
      expect(res.body).not.toHaveProperty('accountEmail');
    });

    it('public with sharing: email and phone are visible', async () => {
      await createProfile(app, alice, {
        ...fullFields,
        visibility: 'public',
        shareEmail: true,
        sharePhone: true,
      });
      const res = await viewAlice();
      expect(res.body).toMatchObject({ email: 'alice@example.com', phone: '+33612345678' });
    });

    it('connections: a stranger only gets the preview', async () => {
      await createProfile(app, alice, {
        ...fullFields,
        visibility: 'connections',
        shareEmail: true,
      });
      const res = await viewAlice();
      expect(res.body).toMatchObject({
        access: 'preview',
        firstName: 'Alice',
        headline: 'Cheffe de projet',
        company: null,
        bio: null,
        email: null,
        phone: null,
      });
    });

    it('private: a stranger only gets the name', async () => {
      await createProfile(app, alice, { ...fullFields, visibility: 'private' });
      const res = await viewAlice();
      expect(res.body).toMatchObject({
        access: 'minimal',
        firstName: 'Alice',
        lastName: 'Martin',
        headline: null,
        photoUrl: null,
      });
    });

    it('viewing oneself by id returns the owner view', async () => {
      await createProfile(app, alice, { visibility: 'private' });
      const res = await request(server)
        .get(`/api/profiles/${alice.id}`)
        .set(bearer(alice.accessToken))
        .expect(200);
      expect(res.body).toMatchObject({ access: 'full', visibility: 'private' });
    });

    it('404 for an unknown user and 400 for a malformed id', async () => {
      await request(server)
        .get(`/api/profiles/${randomUUID()}`)
        .set(bearer(bob.accessToken))
        .expect(404);
      await request(server)
        .get('/api/profiles/not-a-uuid')
        .set(bearer(bob.accessToken))
        .expect(400);
    });
  });

  describe('photo', () => {
    async function upload(user: RegisteredUser, image: Buffer, filename = 'photo.png') {
      return request(server)
        .put('/api/profiles/me/photo')
        .set(bearer(user.accessToken))
        .attach('photo', image, filename);
    }

    it('requires a profile', async () => {
      const res = await upload(alice, await sampleImage());
      expect(res.status).toBe(404);
    });

    it.each(['png', 'jpeg', 'webp'] as const)(
      'accepts %s and stores a resized WebP',
      async (format) => {
        await createProfile(app, alice);
        const res = await upload(
          alice,
          await sampleImage(format, { width: 1200, height: 900 }),
          `photo.${format}`,
        );
        expect(res.status).toBe(200);
        expect(res.body.photoUrl).toMatch(new RegExp(`^/profiles/${alice.id}/photo\\?v=`));

        const photo = await request(server)
          .get(`/api/profiles/${alice.id}/photo`)
          .set(bearer(alice.accessToken))
          .buffer(true)
          .parse((response, done) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () => done(null, Buffer.concat(chunks)));
          })
          .expect(200);
        expect(photo.headers['content-type']).toBe('image/webp');
        const meta = await sharp(photo.body as Buffer).metadata();
        expect(meta.format).toBe('webp');
        expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(512);
      },
    );

    it('strips EXIF metadata', async () => {
      await createProfile(app, alice);
      await upload(alice, await sampleImage('jpeg', { withExif: true }), 'p.jpg').then((r) =>
        expect(r.status).toBe(200),
      );
      const [row] = await app
        .get(DataSource)
        .query<{ photo_key: string }[]>('SELECT photo_key FROM profiles');
      const photo = await request(server)
        .get(`/api/profiles/${alice.id}/photo`)
        .set(bearer(alice.accessToken))
        .buffer(true)
        .parse((response, done) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => done(null, Buffer.concat(chunks)));
        });
      expect(row.photo_key).toMatch(/\.webp$/);
      const meta = await sharp(photo.body as Buffer).metadata();
      expect(meta.exif).toBeUndefined();
    });

    it('rejects a file that only pretends to be an image', async () => {
      await createProfile(app, alice);
      const res = await upload(alice, Buffer.from('<?php echo "hi"; ?>'), 'evil.png');
      expect(res.status).toBe(400);
    });

    it('rejects unsupported formats such as GIF', async () => {
      await createProfile(app, alice);
      const res = await upload(alice, await sampleImage('gif'), 'anim.gif');
      expect(res.status).toBe(400);
    });

    it('rejects files over 5 MB', async () => {
      await createProfile(app, alice);
      const res = await upload(alice, randomBytes(5 * 1024 * 1024 + 1), 'big.png');
      expect(res.status).toBe(413);
    });

    it('rejects a request without file', async () => {
      await createProfile(app, alice);
      await request(server)
        .put('/api/profiles/me/photo')
        .set(bearer(alice.accessToken))
        .expect(400);
    });

    it('replacing the photo changes its URL; deleting removes it', async () => {
      await createProfile(app, alice);
      const first = await upload(alice, await sampleImage());
      const second = await upload(alice, await sampleImage('jpeg'), 'p.jpg');
      expect(second.body.photoUrl).not.toBe(first.body.photoUrl);

      await request(server)
        .delete('/api/profiles/me/photo')
        .set(bearer(alice.accessToken))
        .expect(204);
      await request(server)
        .get(`/api/profiles/${alice.id}/photo`)
        .set(bearer(alice.accessToken))
        .expect(404);
    });

    it('follows the profile visibility for other users', async () => {
      await createProfile(app, alice, { visibility: 'connections' });
      await upload(alice, await sampleImage());
      // `connections` → preview → photo visible to strangers.
      await request(server)
        .get(`/api/profiles/${alice.id}/photo`)
        .set(bearer(bob.accessToken))
        .expect(200);

      await request(server)
        .patch('/api/profiles/me')
        .set(bearer(alice.accessToken))
        .send({ visibility: 'private' })
        .expect(200);
      await request(server)
        .get(`/api/profiles/${alice.id}/photo`)
        .set(bearer(bob.accessToken))
        .expect(404);
    });

    it("bob cannot change or delete alice's photo (only /me routes exist)", async () => {
      await createProfile(app, alice);
      await upload(alice, await sampleImage());
      await createProfile(app, bob, { firstName: 'Bob' });
      await request(server)
        .delete('/api/profiles/me/photo')
        .set(bearer(bob.accessToken))
        .expect(204);
      await request(server)
        .get(`/api/profiles/${alice.id}/photo`)
        .set(bearer(alice.accessToken))
        .expect(200);
    });
  });
});
