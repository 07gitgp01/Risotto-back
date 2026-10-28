import { HttpException, Inject, ValidationPipe } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';
import { RedisThrottlerStorage } from '../../common/throttler/redis-throttler.storage';
import { AuthenticatedSocket, isSocketExpired } from '../realtime/realtime.gateway';
import {
  MessageView,
  ReadReceipt,
  SocketConversationDto,
  SocketSendMessageDto,
} from './dto/messaging.dto';
import { MessagingService } from './messaging.service';

export type SocketAck<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

const SEND_LIMIT = 20;
const SEND_WINDOW_MS = 10_000;

/**
 * Real-time messaging over the authenticated `/ws` namespace. Each event answers with
 * an acknowledgement instead of throwing, so the client always knows the outcome.
 */
@WebSocketGateway({ namespace: '/ws' })
export class MessagingGateway {
  private readonly validation = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  private readonly throttle: RedisThrottlerStorage;

  constructor(
    private readonly messaging: MessagingService,
    @Inject(REDIS_CLIENT) redis: Redis,
  ) {
    this.throttle = new RedisThrottlerStorage(redis, 'throttle-ws');
  }

  @SubscribeMessage('message:send')
  async send(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() body: unknown,
  ): Promise<SocketAck<MessageView>> {
    return this.handle(socket, async () => {
      const dto = await this.validate(SocketSendMessageDto, body);
      const { isBlocked } = await this.throttle.increment(
        socket.data.userId,
        SEND_WINDOW_MS,
        SEND_LIMIT,
        SEND_WINDOW_MS,
        'message-send',
      );
      if (isBlocked) {
        throw new HttpException('Too many messages', 429);
      }
      return this.messaging.send(socket.data.userId, dto.conversationId, dto.body);
    });
  }

  @SubscribeMessage('conversation:read')
  async read(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() body: unknown,
  ): Promise<SocketAck<ReadReceipt>> {
    return this.handle(socket, async () => {
      const dto = await this.validate(SocketConversationDto, body);
      return this.messaging.markRead(socket.data.userId, dto.conversationId);
    });
  }

  private async handle<T>(
    socket: AuthenticatedSocket,
    action: () => Promise<T>,
  ): Promise<SocketAck<T>> {
    if (isSocketExpired(socket)) {
      // The client reconnects with a refreshed token.
      socket.disconnect(true);
      return { ok: false, error: 'Token expired', status: 401 };
    }
    try {
      return { ok: true, data: await action() };
    } catch (error) {
      if (error instanceof HttpException) {
        const response = error.getResponse();
        const message =
          typeof response === 'string'
            ? response
            : ((response as { message?: string | string[] }).message ?? error.message);
        return {
          ok: false,
          error: Array.isArray(message) ? message.join(', ') : message,
          status: error.getStatus(),
        };
      }
      return { ok: false, error: 'Internal error', status: 500 };
    }
  }

  private async validate<T extends object>(type: new () => T, value: unknown): Promise<T> {
    return (await this.validation.transform(value, { type: 'body', metatype: type })) as T;
  }
}
