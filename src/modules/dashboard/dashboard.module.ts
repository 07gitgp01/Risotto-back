import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../connections/connections.module';
import { ContactsModule } from '../contacts/contacts.module';
import { MessagingModule } from '../messaging/messaging.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [ConnectionsModule, MessagingModule, NotificationsModule, ContactsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
