import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { existsSync } from 'fs';
import { AppConfig } from '../../config/configuration';
import { Profile } from '../profiles/profile.entity';
import { ProfilesModule } from '../profiles/profiles.module';
import { DeviceToken } from './entities/device-token.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { Notification } from './entities/notification.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { FcmPushSender, NoopPushSender, PUSH_SENDER, PushSender } from './push/push-sender';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, NotificationPreference, DeviceToken, Profile]),
    ProfilesModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    {
      provide: PUSH_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): PushSender => {
        const path = config.get<AppConfig['push']>('push')?.fcmServiceAccountPath;
        if (path && existsSync(path)) {
          return new FcmPushSender(path);
        }
        new Logger('Push').log('FCM not configured: push notifications are disabled');
        return new NoopPushSender();
      },
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
