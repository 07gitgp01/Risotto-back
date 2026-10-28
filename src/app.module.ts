import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { AUTH_RATE_LIMIT_KEY } from './common/auth/auth.decorators';
import { REDIS_CLIENT } from './common/redis/redis.constants';
import { RedisModule } from './common/redis/redis.module';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler.storage';
import configuration, { AppConfig } from './config/configuration';
import { validateEnv } from './config/env.validation';
import { buildDataSourceOptions } from './database/typeorm-options';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { RelationshipsModule } from './modules/relationships/relationships.module';
import { ConnectionsModule } from './modules/connections/connections.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { MailModule } from './modules/mail/mail.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { UsersModule } from './modules/users/users.module';

const reflector = new Reflector();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate: validateEnv,
      load: [configuration],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        buildDataSourceOptions(config.getOrThrow<AppConfig['db']>('db')),
    }),
    RedisModule,
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, REDIS_CLIENT],
      useFactory: (config: ConfigService, redis: Redis) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.getOrThrow<number>('throttle.ttlMs'),
            limit: config.getOrThrow<number>('throttle.limit'),
          },
          {
            // Stricter budget, only on routes marked @AuthRateLimit().
            name: 'auth',
            ttl: config.getOrThrow<number>('throttle.authTtlMs'),
            limit: config.getOrThrow<number>('throttle.authLimit'),
            skipIf: (context) =>
              !reflector.getAllAndOverride<boolean>(AUTH_RATE_LIMIT_KEY, [
                context.getHandler(),
                context.getClass(),
              ]),
          },
        ],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    HealthModule,
    MailModule,
    UsersModule,
    AuthModule,
    RelationshipsModule,
    ProfilesModule,
    ContactsModule,
    ConnectionsModule,
    RealtimeModule,
    MessagingModule,
    NotificationsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
