import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProfilesModule } from '../profiles/profiles.module';
import { RelationshipsModule } from '../relationships/relationships.module';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { MessagingController } from './messaging.controller';
import { MessagingGateway } from './messaging.gateway';
import { MessagingService } from './messaging.service';

@Module({
  imports: [TypeOrmModule.forFeature([Conversation, Message]), RelationshipsModule, ProfilesModule],
  controllers: [MessagingController],
  providers: [MessagingService, MessagingGateway],
  exports: [MessagingService],
})
export class MessagingModule {}
