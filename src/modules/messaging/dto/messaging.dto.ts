import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ProfileView } from '../../profiles/profile-view';

export const MESSAGE_MAX_LENGTH = 4000;

export class StartConversationDto {
  @IsUUID()
  userId: string;
}

export class SendMessageDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(MESSAGE_MAX_LENGTH)
  body: string;
}

/** Same as SendMessageDto, over the WebSocket. */
export class SocketSendMessageDto extends SendMessageDto {
  @IsUUID()
  conversationId: string;
}

export class SocketConversationDto {
  @IsUUID()
  conversationId: string;
}

export class MessagesQuery {
  /** Id of the oldest message already loaded: returns older ones. */
  @IsOptional()
  @IsUUID()
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 30;
}

export interface MessageView {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
}

export interface ConversationView {
  id: string;
  /** The other participant. */
  user: ProfileView;
  lastMessage: MessageView | null;
  unreadCount: number;
  /** When the other participant last read the conversation (read receipts). */
  otherLastReadAt: string | null;
  /** False when the users are no longer connected: history stays readable, sending is off. */
  canSend: boolean;
  updatedAt: string;
}

export interface MessagePage {
  /** Newest first. */
  messages: MessageView[];
  /** Pass as `before` to load older messages; null when the start is reached. */
  nextCursor: string | null;
  otherLastReadAt: string | null;
}

export interface ReadReceipt {
  conversationId: string;
  userId: string;
  readAt: string;
}
