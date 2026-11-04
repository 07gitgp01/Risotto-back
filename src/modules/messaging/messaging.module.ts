import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProfilesModule } from '../profiles/profiles.module';
import { RelationshipsModule } from '../relationships/relationships.module';
import { User } from '../users/user.entity';
import { Conversation } from './entities/conversation.entity';
import { MessageReaction } from './entities/message-reaction.entity';
import { Message } from './entities/message.entity';
import { MessagingController, PresenceController } from './messaging.controller';
import { MessagingGateway } from './messaging.gateway';
import { MessagingService } from './messaging.service';
import { PresenceService } from './presence.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Conversation, Message, MessageReaction, User]),
    RelationshipsModule,
    ProfilesModule,
  ],
  controllers: [MessagingController, PresenceController],
  providers: [MessagingService, MessagingGateway, PresenceService],
  exports: [MessagingService],
})
export class MessagingModule {}
