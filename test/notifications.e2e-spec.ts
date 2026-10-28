import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { App } from 'supertest/types';
import { REDIS_CLIENT } from '../src/common/redis/redis.constants';
import { bearer, registerUser, RegisteredUser } from './utils/auth-helpers';
import { createTestApp, resetDatabase } from './utils/create-test-app';
import { eventually } from './utils/eventually';
import { FakePushSender } from './utils/fake-push-sender';
import { createProfile } from './utils/profile-helpers';

const DEVICE_TOKEN = 'fcm-token-alice-0123456789';

interface NotificationBody {
  id: string;
  type: string;
  actor: { userId: string; firstName: string } | null;
  data: Record<string, string>;
  readAt: string | null;
}

describe('Notifications (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let url: string;
  let push: FakePushSender;
  let alice: RegisteredUser;
  let bob: RegisteredUser;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    const testApp = await createTestApp([], { listen: true });
    ({ app, push } = testApp);
    url = testApp.url as string;
    server = app.getHttpServer();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    await app.get<Redis>(REDIS_CLIENT).flushdb();
    push.clear();
    alice = await registerUser(app, 'alice@example.com');
    bob = await registerUser(app, 'bob@example.com');
    await createProfile(app, alice, {
      firstName: 'Alice',
      lastName: 'Martin',
      visibility: 'public',
    });
    await createProfile(app, bob, { firstName: 'Bob', lastName: 'Durand', visibility: 'public' });
  });

  afterEach(() => {
    sockets.splice(0).forEach((socket) => socket.disconnect());
  });

  afterAll(async () => {
    await app.close();
  });

  const registerDevice = (user: RegisteredUser, token = DEVICE_TOKEN) =>
    request(server)
      .post('/api/devices')
      .set(bearer(user.accessToken))
      .send({ token, platform: 'android' });

  const listOf = async (user: RegisteredUser) =>
    (await request(server).get('/api/notifications').set(bearer(user.accessToken)).expect(200))
      .body as {
      notifications: NotificationBody[];
      unreadCount: number;
      nextCursor: string | null;
    };

  async function bobAsksAlice(): Promise<string> {
    const res = await request(server)
      .post('/api/connections')
      .set(bearer(bob.accessToken))
      .send({ userId: alice.id })
      .expect(201);
    return res.body.id as string;
  }

  describe('authentication is required on every route', () => {
    it.each([
      ['get', '/api/notifications'],
      ['post', '/api/notifications/read-all'],
      ['get', '/api/notifications/preferences'],
      ['put', '/api/notifications/preferences'],
      ['post', `/api/notifications/${randomUUID()}/read`],
      ['post', '/api/devices'],
      ['delete', '/api/devices'],
    ] as const)('%s %s → 401', async (method, path) => {
      await request(server)[method](path).expect(401);
    });
  });

  describe('connection events', () => {
    it('a request notifies the recipient in-app and by push', async () => {
      await registerDevice(alice).expect(204);
      const connectionId = await bobAsksAlice();

      await eventually(async () => {
        const list = await listOf(alice);
        expect(list.unreadCount).toBe(1);
        expect(list.notifications[0]).toMatchObject({
          type: 'connection_request',
          actor: { userId: bob.id, firstName: 'Bob' },
          data: { connectionId },
          readAt: null,
        });
      });
      await eventually(() => {
        expect(push.sent).toHaveLength(1);
        expect(push.sent[0].tokens).toEqual([DEVICE_TOKEN]);
        expect(push.sent[0].message).toMatchObject({
          title: 'Nouvelle demande de mise en relation',
          body: 'Bob Durand souhaite rejoindre votre réseau.',
          data: { type: 'connection_request', connectionId },
        });
      });
      // Bob gets nothing for his own request.
      expect((await listOf(bob)).notifications).toEqual([]);
    });

    it('accepting notifies the requester', async () => {
      const connectionId = await bobAsksAlice();
      await request(server)
        .post(`/api/connections/${connectionId}/accept`)
        .set(bearer(alice.accessToken))
        .expect(200);
      await eventually(async () => {
        const list = await listOf(bob);
        expect(list.notifications[0]).toMatchObject({
          type: 'connection_accepted',
          actor: { userId: alice.id },
        });
      });
    });

    it('is pushed in real time over the socket', async () => {
      const socket = io(`${url}/ws`, {
        auth: { token: alice.accessToken },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      });
      sockets.push(socket);
      await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
      const received = new Promise<NotificationBody>((resolve) =>
        socket.once('notification:new', resolve),
      );
      await bobAsksAlice();
      expect(await received).toMatchObject({ type: 'connection_request' });
    });
  });

  describe('messages', () => {
    it('push the sender name without the message content, no in-app entry', async () => {
      await registerDevice(alice).expect(204);
      const connectionId = await bobAsksAlice();
      await request(server)
        .post(`/api/connections/${connectionId}/accept`)
        .set(bearer(alice.accessToken))
        .expect(200);
      const conversation = await request(server)
        .post('/api/conversations')
        .set(bearer(bob.accessToken))
        .send({ userId: alice.id })
        .expect(201);
      push.clear();

      await request(server)
        .post(`/api/conversations/${conversation.body.id}/messages`)
        .set(bearer(bob.accessToken))
        .send({ body: 'Code secret 4242' })
        .expect(201);

      await eventually(() => {
        expect(push.sent).toHaveLength(1);
        expect(push.sent[0].message).toMatchObject({
          title: 'Bob Durand',
          body: 'Nouveau message',
          data: { type: 'message', conversationId: conversation.body.id },
        });
      });
      expect(JSON.stringify(push.sent)).not.toContain('4242');
      expect((await listOf(alice)).notifications.map((n) => n.type)).not.toContain('message');
    });
  });

  describe('list', () => {
    it('marks one or all notifications as read, only for their owner', async () => {
      await bobAsksAlice();
      await eventually(async () => expect((await listOf(alice)).unreadCount).toBe(1));
      const [notification] = (await listOf(alice)).notifications;

      await request(server)
        .post(`/api/notifications/${notification.id}/read`)
        .set(bearer(bob.accessToken))
        .expect(404);
      await request(server)
        .post(`/api/notifications/${notification.id}/read`)
        .set(bearer(alice.accessToken))
        .expect(204);
      expect((await listOf(alice)).unreadCount).toBe(0);

      await request(server)
        .post('/api/notifications/read-all')
        .set(bearer(alice.accessToken))
        .expect(204);
    });

    it('hides notifications from a member blocked since', async () => {
      await bobAsksAlice();
      await eventually(async () => expect((await listOf(alice)).notifications).toHaveLength(1));
      await request(server)
        .post('/api/blocks')
        .set(bearer(alice.accessToken))
        .send({ userId: bob.id })
        .expect(204);
      expect((await listOf(alice)).notifications).toEqual([]);
    });
  });

  describe('preferences', () => {
    it('have sensible defaults', async () => {
      const res = await request(server)
        .get('/api/notifications/preferences')
        .set(bearer(alice.accessToken))
        .expect(200);
      expect(res.body).toEqual([
        { type: 'connection_request', inApp: true, push: true, supportsInApp: true },
        { type: 'connection_accepted', inApp: true, push: true, supportsInApp: true },
        { type: 'message', inApp: false, push: true, supportsInApp: false },
      ]);
    });

    it('are respected', async () => {
      await registerDevice(alice).expect(204);
      await request(server)
        .put('/api/notifications/preferences')
        .set(bearer(alice.accessToken))
        .send({ preferences: [{ type: 'connection_request', inApp: false, push: false }] })
        .expect(200);
      await bobAsksAlice();
      // Give the async handler a moment, then check nothing was produced.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect((await listOf(alice)).notifications).toEqual([]);
      expect(push.sent).toEqual([]);
    });

    it('message notifications can never be in-app', async () => {
      const res = await request(server)
        .put('/api/notifications/preferences')
        .set(bearer(alice.accessToken))
        .send({ preferences: [{ type: 'message', inApp: true, push: false }] })
        .expect(200);
      expect(res.body[2]).toEqual({
        type: 'message',
        inApp: false,
        push: false,
        supportsInApp: false,
      });
    });

    it('validates the payload', async () => {
      for (const body of [
        { preferences: [{ type: 'unknown', push: true }] },
        { preferences: [{ type: 'message', push: 'yes' }] },
        { preferences: 'all' },
      ]) {
        await request(server)
          .put('/api/notifications/preferences')
          .set(bearer(alice.accessToken))
          .send(body)
          .expect(400);
      }
    });
  });

  describe('devices', () => {
    it('a token moves to the last user signed in on the device', async () => {
      await registerDevice(alice).expect(204);
      await registerDevice(bob).expect(204);
      await bobAsksAlice();
      await new Promise((resolve) => setTimeout(resolve, 300));
      // Alice no longer owns the device: no push for her.
      expect(push.sent).toEqual([]);
    });

    it('invalid tokens reported by FCM are removed', async () => {
      await registerDevice(alice).expect(204);
      push.invalid.add(DEVICE_TOKEN);
      await bobAsksAlice();
      await eventually(() => expect(push.sent).toHaveLength(1));

      push.clear();
      const second = await request(server)
        .delete(
          `/api/connections/${(await request(server).get('/api/connections/requests?direction=outgoing').set(bearer(bob.accessToken))).body[0].id}`,
        )
        .set(bearer(bob.accessToken));
      expect(second.status).toBe(204);
      await bobAsksAlice();
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(push.sent).toEqual([]);
    });

    it('only the owner can remove a token', async () => {
      await registerDevice(alice).expect(204);
      await request(server)
        .delete('/api/devices')
        .set(bearer(bob.accessToken))
        .send({ token: DEVICE_TOKEN })
        .expect(204);
      await bobAsksAlice();
      await eventually(() => expect(push.sent).toHaveLength(1));

      await request(server)
        .delete('/api/devices')
        .set(bearer(alice.accessToken))
        .send({ token: DEVICE_TOKEN })
        .expect(204);
    });

    it('validates the device', async () => {
      await registerDevice(alice, 'short').expect(400);
      await request(server)
        .post('/api/devices')
        .set(bearer(alice.accessToken))
        .send({ token: DEVICE_TOKEN, platform: 'windows' })
        .expect(400);
    });
  });
});
