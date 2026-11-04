import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { TokensService } from '../auth/tokens.service';
import {
  RealtimeEvents,
  RealtimeService,
  SocketDisconnectedEvent,
  SocketLifecycleEvent,
  userRoom,
} from './realtime.service';

/** While a socket is open, presence is refreshed at this pace. */
export const HEARTBEAT_MS = 45_000;

export interface SocketData {
  userId: string;
  /** Access token expiry (epoch seconds): events after it are refused. */
  tokenExpiresAt: number;
}

export type AuthenticatedSocket = Socket<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  SocketData
>;

/** Authenticates sockets with the access token and joins each one to its user room. */
@WebSocketGateway({ namespace: '/ws' })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly tokens: TokensService,
    private readonly realtime: RealtimeService,
    private readonly events: EventEmitter2,
  ) {}

  afterInit(server: Server): void {
    this.realtime.attach(server);
    server.use((socket, next) => {
      const token: unknown = (socket.handshake.auth as Record<string, unknown> | undefined)?.token;
      if (typeof token !== 'string' || token.length === 0) {
        return next(new Error('unauthorized'));
      }
      void (async () => {
        try {
          const payload = this.tokens.verifyAccessToken(token);
          if (!payload.sid || (await this.tokens.isAccessTokenRevoked(payload))) {
            return next(new Error('unauthorized'));
          }
          const data = socket.data as SocketData;
          data.userId = payload.sub;
          data.tokenExpiresAt = payload.exp ?? 0;
          next();
        } catch {
          next(new Error('unauthorized'));
        }
      })();
    });
  }

  async handleConnection(socket: AuthenticatedSocket): Promise<void> {
    const { userId } = socket.data;
    await socket.join(userRoom(userId));
    this.logger.debug(`Socket connected for user ${userId}`);

    const event: SocketLifecycleEvent = { userId };
    this.events.emit(RealtimeEvents.connected, event);
    const heartbeat = setInterval(
      () => this.events.emit(RealtimeEvents.heartbeat, event),
      HEARTBEAT_MS,
    );
    socket.once('disconnect', () => {
      clearInterval(heartbeat);
      void this.realtime
        .socketCount(userId, socket.id)
        .catch(() => 0)
        .then((remaining) =>
          this.events.emit(RealtimeEvents.disconnected, {
            userId,
            remaining,
          } satisfies SocketDisconnectedEvent),
        );
    });
  }
}

/** True when the token used to open the socket has expired since. */
export function isSocketExpired(socket: AuthenticatedSocket): boolean {
  return socket.data.tokenExpiresAt * 1000 < Date.now();
}
