import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { App } from 'supertest/types';
import { REDIS_CLIENT } from '../src/common/redis/redis.constants';
import { bearer, registerUser, RegisteredUser } from './utils/auth-helpers';
import { createTestApp, resetDatabase } from './utils/create-test-app';
import { eventually } from './utils/eventually';
import { createProfile } from './utils/profile-helpers';

describe('Dashboard (e2e)', () => {
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
    for (const [user, firstName] of [
      [alice, 'Alice'],
      [bob, 'Bob'],
      [carol, 'Carol'],
    ] as const) {
      await createProfile(app, user, { firstName, visibility: 'public' });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  const dashboardOf = async (user: RegisteredUser) =>
    (await request(server).get('/api/dashboard').set(bearer(user.accessToken)).expect(200))
      .body as {
      pendingRequests: { count: number; latest: { user: { userId: string } }[] };
      unreadMessages: { count: number; conversations: { id: string; unreadCount: number }[] };
      unreadNotifications: number;
      stats: { connections: number; contacts: number };
      recentActivity: { type: string; actor: { userId: string } }[];
    };

  it('requires authentication', async () => {
    await request(server).get('/api/dashboard').expect(401);
  });

  it('is empty for a new member', async () => {
    expect(await dashboardOf(alice)).toEqual({
      pendingRequests: { count: 0, latest: [] },
      unreadMessages: { count: 0, conversations: [] },
      unreadNotifications: 0,
      stats: { connections: 0, contacts: 0 },
      recentActivity: [],
    });
  });

  it('summarises requests, unread messages and recent activity', async () => {
    // Bob and Carol ask Alice; Alice accepts Bob, who then writes to her twice.
    const fromBob = await request(server)
      .post('/api/connections')
      .set(bearer(bob.accessToken))
      .send({ userId: alice.id })
      .expect(201);
    await request(server)
      .post('/api/connections')
      .set(bearer(carol.accessToken))
      .send({ userId: alice.id })
      .expect(201);
    await request(server)
      .post(`/api/connections/${fromBob.body.id}/accept`)
      .set(bearer(alice.accessToken))
      .expect(200);
    const conversation = await request(server)
      .post('/api/conversations')
      .set(bearer(bob.accessToken))
      .send({ userId: alice.id })
      .expect(201);
    for (const body of ['Salut', 'Tu es dispo ?']) {
      await request(server)
        .post(`/api/conversations/${conversation.body.id}/messages`)
        .set(bearer(bob.accessToken))
        .send({ body })
        .expect(201);
    }

    await eventually(async () => {
      const dashboard = await dashboardOf(alice);
      expect(dashboard.pendingRequests.count).toBe(1);
      expect(dashboard.pendingRequests.latest[0].user.userId).toBe(carol.id);
      expect(dashboard.unreadMessages.count).toBe(2);
      expect(dashboard.unreadMessages.conversations).toEqual([
        expect.objectContaining({ id: conversation.body.id, unreadCount: 2 }),
      ]);
      expect(dashboard.stats).toEqual({ connections: 1, contacts: 0 });
      expect(dashboard.unreadNotifications).toBe(2);
      expect(dashboard.recentActivity.map((a) => a.type)).toEqual(
        expect.arrayContaining(['message', 'connection_request']),
      );
    });

    // Bob's view: his connection was accepted.
    await eventually(async () => {
      const dashboard = await dashboardOf(bob);
      expect(dashboard.stats.connections).toBe(1);
      expect(dashboard.recentActivity[0]).toMatchObject({
        type: 'connection_accepted',
        actor: { userId: alice.id },
      });
      expect(dashboard.unreadMessages.count).toBe(0);
    });
  });

  it('only ever shows the current user’s data', async () => {
    await request(server)
      .post('/api/connections')
      .set(bearer(bob.accessToken))
      .send({ userId: alice.id })
      .expect(201);
    const carolDashboard = await dashboardOf(carol);
    expect(carolDashboard.pendingRequests.count).toBe(0);
    expect(carolDashboard.recentActivity).toEqual([]);
  });

  it('hides activity of a blocked member', async () => {
    await request(server)
      .post('/api/connections')
      .set(bearer(bob.accessToken))
      .send({ userId: alice.id })
      .expect(201);
    await eventually(async () => expect((await dashboardOf(alice)).recentActivity).toHaveLength(1));
    await request(server)
      .post('/api/blocks')
      .set(bearer(alice.accessToken))
      .send({ userId: bob.id })
      .expect(204);
    const dashboard = await dashboardOf(alice);
    expect(dashboard.pendingRequests.count).toBe(0);
    expect(dashboard.recentActivity).toEqual([]);
    expect(dashboard.unreadNotifications).toBe(0);
  });
});
