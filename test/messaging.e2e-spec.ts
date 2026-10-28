import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { REDIS_CLIENT } from '../src/common/redis/redis.constants';
import { bearer, registerUser, RegisteredUser } from './utils/auth-helpers';
import { createTestApp, resetDatabase } from './utils/create-test-app';
import { createProfile } from './utils/profile-helpers';

interface MessageEvent {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
}

describe('Messaging (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let url: string;
  let alice: RegisteredUser;
  let bob: RegisteredUser;
  let carol: RegisteredUser;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    const testApp = await createTestApp([], { listen: true });
    app = testApp.app;
    url = testApp.url as string;
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
    await connect(alice, bob);
  });

  afterEach(() => {
    sockets.splice(0).forEach((socket) => socket.disconnect());
  });

  afterAll(async () => {
    await app.close();
  });

  async function connect(from: RegisteredUser, to: RegisteredUser): Promise<void> {
    const res = await request(server)
      .post('/api/connections')
      .set(bearer(from.accessToken))
      .send({ userId: to.id })
      .expect(201);
    await request(server)
      .post(`/api/connections/${res.body.id}/accept`)
      .set(bearer(to.accessToken))
      .expect(200);
  }

  async function startConversation(from: RegisteredUser, to: RegisteredUser): Promise<string> {
    const res = await request(server)
      .post('/api/conversations')
      .set(bearer(from.accessToken))
      .send({ userId: to.id })
      .expect(201);
    return res.body.id as string;
  }

  const send = (user: RegisteredUser, conversationId: string, body: string) =>
    request(server)
      .post(`/api/conversations/${conversationId}/messages`)
      .set(bearer(user.accessToken))
      .send({ body });

  function openSocket(token: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(`${url}/ws`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      });
      sockets.push(socket);
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', (error) => reject(error));
    });
  }

  function nextEvent<T>(socket: Socket, event: string, timeoutMs = 3000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No ${event} event`)), timeoutMs);
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  describe('authentication is required on every route', () => {
    it.each([
      ['get', '/api/conversations'],
      ['post', '/api/conversations'],
      ['get', `/api/conversations/${randomUUID()}`],
      ['get', `/api/conversations/${randomUUID()}/messages`],
      ['post', `/api/conversations/${randomUUID()}/messages`],
      ['post', `/api/conversations/${randomUUID()}/read`],
    ] as const)('%s %s → 401', async (method, path) => {
      await request(server)[method](path).expect(401);
    });

    it('refuses a socket without a valid token', async () => {
      await expect(openSocket('')).rejects.toThrow('unauthorized');
      await expect(openSocket('not-a-jwt')).rejects.toThrow('unauthorized');
      const forged = new JwtService({ secret: 'x'.repeat(48) }).sign({ sub: alice.id });
      await expect(openSocket(forged)).rejects.toThrow('unauthorized');
    });
  });

  describe('conversations', () => {
    it('can only be started with a connection', async () => {
      await request(server)
        .post('/api/conversations')
        .set(bearer(alice.accessToken))
        .send({ userId: carol.id })
        .expect(403);
      await request(server)
        .post('/api/conversations')
        .set(bearer(alice.accessToken))
        .send({ userId: alice.id })
        .expect(403);
    });

    it('is the same conversation from both sides', async () => {
      const first = await startConversation(alice, bob);
      const second = await startConversation(bob, alice);
      expect(second).toBe(first);
    });

    it('is invisible to non-members', async () => {
      const id = await startConversation(alice, bob);
      await request(server)
        .get(`/api/conversations/${id}`)
        .set(bearer(carol.accessToken))
        .expect(404);
      await request(server)
        .get(`/api/conversations/${id}/messages`)
        .set(bearer(carol.accessToken))
        .expect(404);
      await send(carol, id, 'intrusion').expect(404);
      await request(server)
        .post(`/api/conversations/${id}/read`)
        .set(bearer(carol.accessToken))
        .expect(404);
      const list = await request(server).get('/api/conversations').set(bearer(carol.accessToken));
      expect(list.body).toEqual([]);
    });
  });

  describe('messages', () => {
    it('are stored encrypted, never in clear', async () => {
      const id = await startConversation(alice, bob);
      await send(alice, id, 'Le code du coffre est 1234').expect(201);
      const rows = await app
        .get(DataSource)
        .query<{ ciphertext: Buffer; iv: Buffer; auth_tag: Buffer; key_version: number }[]>(
          'SELECT ciphertext, iv, auth_tag, key_version FROM messages',
        );
      expect(rows).toHaveLength(1);
      expect(rows[0].ciphertext.toString('utf8')).not.toContain('coffre');
      expect(rows[0].iv).toHaveLength(12);
      expect(rows[0].auth_tag).toHaveLength(16);
      expect(rows[0].key_version).toBe(1);
      const dump = await app
        .get(DataSource)
        .query<{ dump: string }[]>(`SELECT messages::text AS dump FROM messages`);
      expect(dump[0].dump).not.toContain('coffre');
    });

    it('validates the body', async () => {
      const id = await startConversation(alice, bob);
      await send(alice, id, '   ').expect(400);
      await send(alice, id, 'x'.repeat(4001)).expect(400);
      await request(server)
        .post(`/api/conversations/${id}/messages`)
        .set(bearer(alice.accessToken))
        .send({ body: 'hi', senderId: bob.id })
        .expect(400);
    });

    it('history is paginated newest first with a cursor', async () => {
      const id = await startConversation(alice, bob);
      for (let i = 1; i <= 5; i++) {
        await send(i % 2 ? alice : bob, id, `message ${i}`).expect(201);
      }
      const first = await request(server)
        .get(`/api/conversations/${id}/messages?limit=2`)
        .set(bearer(bob.accessToken))
        .expect(200);
      expect((first.body.messages as MessageEvent[]).map((m) => m.body)).toEqual([
        'message 5',
        'message 4',
      ]);
      expect(first.body.nextCursor).toBe(first.body.messages[1].id);

      const second = await request(server)
        .get(`/api/conversations/${id}/messages?limit=2&before=${first.body.nextCursor}`)
        .set(bearer(bob.accessToken))
        .expect(200);
      expect((second.body.messages as MessageEvent[]).map((m) => m.body)).toEqual([
        'message 3',
        'message 2',
      ]);

      const last = await request(server)
        .get(`/api/conversations/${id}/messages?limit=2&before=${second.body.nextCursor}`)
        .set(bearer(bob.accessToken))
        .expect(200);
      expect((last.body.messages as MessageEvent[]).map((m) => m.body)).toEqual(['message 1']);
      expect(last.body.nextCursor).toBeNull();
    });

    it('unread counts and read receipts', async () => {
      const id = await startConversation(alice, bob);
      await send(alice, id, 'un').expect(201);
      await send(alice, id, 'deux').expect(201);

      let bobList = await request(server).get('/api/conversations').set(bearer(bob.accessToken));
      expect(bobList.body[0]).toMatchObject({
        unreadCount: 2,
        lastMessage: { body: 'deux' },
        user: { userId: alice.id },
        canSend: true,
      });
      const aliceList = await request(server)
        .get('/api/conversations')
        .set(bearer(alice.accessToken));
      expect(aliceList.body[0].unreadCount).toBe(0);
      expect(aliceList.body[0].otherLastReadAt).toBeNull();

      await request(server)
        .post(`/api/conversations/${id}/read`)
        .set(bearer(bob.accessToken))
        .expect(200);
      bobList = await request(server).get('/api/conversations').set(bearer(bob.accessToken));
      expect(bobList.body[0].unreadCount).toBe(0);
      const aliceView = await request(server)
        .get(`/api/conversations/${id}`)
        .set(bearer(alice.accessToken));
      expect(aliceView.body.otherLastReadAt).not.toBeNull();
    });

    it('after the connection is removed, history stays but sending stops', async () => {
      const id = await startConversation(alice, bob);
      await send(alice, id, 'avant').expect(201);
      const connections = await request(server)
        .get('/api/connections')
        .set(bearer(alice.accessToken));
      await request(server)
        .delete(`/api/connections/${connections.body[0].id}`)
        .set(bearer(alice.accessToken))
        .expect(204);

      await send(alice, id, 'après').expect(403);
      const history = await request(server)
        .get(`/api/conversations/${id}/messages`)
        .set(bearer(bob.accessToken))
        .expect(200);
      expect(history.body.messages[0].body).toBe('avant');
      const view = await request(server)
        .get(`/api/conversations/${id}`)
        .set(bearer(bob.accessToken));
      expect(view.body.canSend).toBe(false);
    });

    it('a block hides the conversation from both users', async () => {
      const id = await startConversation(alice, bob);
      await send(alice, id, 'hello').expect(201);
      await request(server)
        .post('/api/blocks')
        .set(bearer(bob.accessToken))
        .send({ userId: alice.id })
        .expect(204);
      for (const user of [alice, bob]) {
        await request(server)
          .get(`/api/conversations/${id}/messages`)
          .set(bearer(user.accessToken))
          .expect(404);
        const list = await request(server).get('/api/conversations').set(bearer(user.accessToken));
        expect(list.body).toEqual([]);
      }
    });
  });

  describe('WebSocket', () => {
    it('pushes new messages to the recipient and to the sender’s other devices', async () => {
      const id = await startConversation(alice, bob);
      const bobSocket = await openSocket(bob.accessToken);
      const aliceOtherDevice = await openSocket(alice.accessToken);
      const carolSocket = await openSocket(carol.accessToken);
      let carolReceived = false;
      carolSocket.on('message:new', () => (carolReceived = true));

      const forBob = nextEvent<MessageEvent>(bobSocket, 'message:new');
      const forAlice = nextEvent<MessageEvent>(aliceOtherDevice, 'message:new');
      await send(alice, id, 'Salut Bob').expect(201);

      expect(await forBob).toMatchObject({
        conversationId: id,
        senderId: alice.id,
        body: 'Salut Bob',
      });
      expect((await forAlice).body).toBe('Salut Bob');
      expect(carolReceived).toBe(false);
    });

    it('sends a message over the socket with an acknowledgement', async () => {
      const id = await startConversation(alice, bob);
      const aliceSocket = await openSocket(alice.accessToken);
      const bobSocket = await openSocket(bob.accessToken);
      const forBob = nextEvent<MessageEvent>(bobSocket, 'message:new');

      const ack = (await aliceSocket.emitWithAck('message:send', {
        conversationId: id,
        body: ' Via WebSocket ',
      })) as { ok: boolean; data: MessageEvent };
      expect(ack.ok).toBe(true);
      expect(ack.data.body).toBe('Via WebSocket');
      expect((await forBob).id).toBe(ack.data.id);
    });

    it('socket errors are acknowledged, not thrown', async () => {
      const id = await startConversation(alice, bob);
      const carolSocket = await openSocket(carol.accessToken);
      const notMember = (await carolSocket.emitWithAck('message:send', {
        conversationId: id,
        body: 'intrusion',
      })) as { ok: boolean; status: number };
      expect(notMember).toMatchObject({ ok: false, status: 404 });

      const invalid = (await carolSocket.emitWithAck('message:send', {
        conversationId: 'nope',
        body: '',
      })) as { ok: boolean; status: number };
      expect(invalid).toMatchObject({ ok: false, status: 400 });
    });

    it('limits the message rate per user', async () => {
      const id = await startConversation(alice, bob);
      const aliceSocket = await openSocket(alice.accessToken);
      const acks: { ok: boolean; status?: number }[] = [];
      for (let i = 0; i < 22; i++) {
        acks.push(
          (await aliceSocket.emitWithAck('message:send', {
            conversationId: id,
            body: `m${i}`,
          })) as {
            ok: boolean;
          },
        );
      }
      expect(acks.filter((a) => a.ok)).toHaveLength(20);
      expect(acks[21]).toMatchObject({ ok: false, status: 429 });
    });

    it('read receipts reach the other participant', async () => {
      const id = await startConversation(alice, bob);
      await send(alice, id, 'lu ?').expect(201);
      const aliceSocket = await openSocket(alice.accessToken);
      const bobSocket = await openSocket(bob.accessToken);
      const receipt = nextEvent<{ conversationId: string; userId: string }>(
        aliceSocket,
        'conversation:read',
      );
      const ack = (await bobSocket.emitWithAck('conversation:read', { conversationId: id })) as {
        ok: boolean;
      };
      expect(ack.ok).toBe(true);
      expect(await receipt).toMatchObject({ conversationId: id, userId: bob.id });
    });

    it('logout-all closes the user’s sockets', async () => {
      const bobSocket = await openSocket(bob.accessToken);
      const closed = nextEvent<string>(bobSocket, 'disconnect');
      await request(server).post('/api/auth/logout-all').set(bearer(bob.accessToken)).expect(204);
      expect(await closed).toBe('io server disconnect');
    });
  });
});
