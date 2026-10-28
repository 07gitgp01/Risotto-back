import { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Server, ServerOptions } from 'socket.io';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';

/** Socket.IO through Redis pub/sub, so events reach users connected to any API instance. */
export class RedisIoAdapter extends IoAdapter {
  private readonly clients: Redis[] = [];

  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const config = this.app.get(ConfigService);
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: config.get<string[]>('corsOrigins') ?? [], credentials: false },
      // Small payloads only: messages are capped at 4,000 characters.
      maxHttpBufferSize: 64 * 1024,
    }) as Server;

    const redis = this.app.get<Redis>(REDIS_CLIENT);
    const pub = redis.duplicate();
    const sub = redis.duplicate();
    this.clients.push(pub, sub);
    server.adapter(createAdapter(pub, sub));
    return server;
  }

  override async close(server: Server): Promise<void> {
    await super.close(server);
    await Promise.all(this.clients.splice(0).map((client) => client.quit().catch(() => undefined)));
  }
}
