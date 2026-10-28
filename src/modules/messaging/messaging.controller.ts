import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser } from '../../common/auth/auth.decorators';
import {
  ConversationView,
  MessagePage,
  MessagesQuery,
  MessageView,
  ReadReceipt,
  SendMessageDto,
  StartConversationDto,
} from './dto/messaging.dto';
import { MessagingService } from './messaging.service';

@Controller('conversations')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ConversationView[]> {
    return this.messaging.list(user.id);
  }

  @Post()
  start(
    @CurrentUser() user: AuthUser,
    @Body() dto: StartConversationDto,
  ): Promise<ConversationView> {
    return this.messaging.start(user.id, dto.userId);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConversationView> {
    return this.messaging.get(user.id, id);
  }

  @Get(':id/messages')
  history(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MessagesQuery,
  ): Promise<MessagePage> {
    return this.messaging.history(user.id, id, query);
  }

  @Post(':id/messages')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  send(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ): Promise<MessageView> {
    return this.messaging.send(user.id, id, dto.body);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  markRead(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReadReceipt> {
    return this.messaging.markRead(user.id, id);
  }
}
