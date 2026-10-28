import { Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { TokensService } from '../auth/tokens.service';
import { RealtimeService, userRoom } from './realtime.service';

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
  ) {}

  afterInit(server: Server): void {
    this.realtime.attach(server);
    server.use((socket, next) => {
      const token: unknown = (socket.handshake.auth as Record<string, unknown> | undefined)?.token;
      if (typeof token !== 'string' || token.length === 0) {
        return next(new Error('unauthorized'));
      }
      try {
        const payload = this.tokens.verifyAccessToken(token) as { sub: string; exp?: number };
        const data = socket.data as SocketData;
        data.userId = payload.sub;
        data.tokenExpiresAt = payload.exp ?? 0;
        next();
      } catch {
        next(new Error('unauthorized'));
      }
    });
  }

  async handleConnection(socket: AuthenticatedSocket): Promise<void> {
    await socket.join(userRoom(socket.data.userId));
    this.logger.debug(`Socket connected for user ${socket.data.userId}`);
  }
}

/** True when the token used to open the socket has expired since. */
export function isSocketExpired(socket: AuthenticatedSocket): boolean {
  return socket.data.tokenExpiresAt * 1000 < Date.now();
}
