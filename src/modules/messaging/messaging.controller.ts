import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser } from '../../common/auth/auth.decorators';
import {
  ConversationView,
  EditMessageDto,
  MessagePage,
  MessagesQuery,
  MessageView,
  PresenceSettingsDto,
  ReactDto,
  ReadReceipt,
  SendMessageDto,
  StartConversationDto,
} from './dto/messaging.dto';
import { MessagingService } from './messaging.service';
import { PresenceService } from './presence.service';

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
    return this.messaging.send(user.id, id, dto);
  }

  @Patch(':id/messages/:messageId')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  edit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: EditMessageDto,
  ): Promise<MessageView> {
    return this.messaging.edit(user.id, id, messageId, dto.body);
  }

  @Delete(':id/messages/:messageId')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<MessageView> {
    return this.messaging.remove(user.id, id, messageId);
  }

  @Put(':id/messages/:messageId/reaction')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  react(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: ReactDto,
  ): Promise<MessageView> {
    return this.messaging.react(user.id, id, messageId, dto.emoji);
  }

  @Delete(':id/messages/:messageId/reaction')
  unreact(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<MessageView> {
    return this.messaging.react(user.id, id, messageId, null);
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

/** Whether the online status and last seen are shared (reciprocal). */
@Controller('presence')
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Get('settings')
  async settings(@CurrentUser() user: AuthUser): Promise<PresenceSettingsDto> {
    return { sharePresence: await this.presence.getSharePresence(user.id) };
  }

  @Put('settings')
  async update(
    @CurrentUser() user: AuthUser,
    @Body() dto: PresenceSettingsDto,
  ): Promise<PresenceSettingsDto> {
    return { sharePresence: await this.presence.setSharePresence(user.id, dto.sharePresence) };
  }
}
