import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Matches,
  Min,
} from 'class-validator';
import { ProfileView } from '../../profiles/profile-view';

export const MESSAGE_MAX_LENGTH = 4000;

export class StartConversationDto {
  @IsUUID()
  userId: string;
}

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class EditMessageDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MESSAGE_MAX_LENGTH)
  body: string;
}

export class SendMessageDto extends EditMessageDto {
  @IsOptional()
  @IsUUID()
  replyToId?: string;

  /** Random id chosen by the device, so that a retried send is not duplicated. */
  @IsOptional()
  @IsUUID()
  clientId?: string;
}

/** A single emoji (with skin tone or ZWJ sequence). */
export const EMOJI_PATTERN =
  /^(?=.*\p{Extended_Pictographic})(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f)+$/u;

export class ReactDto {
  @IsString()
  @MaxLength(32)
  @Matches(EMOJI_PATTERN, { message: 'emoji must be a single emoji' })
  emoji: string;
}

export class PresenceSettingsDto {
  @IsBoolean()
  sharePresence: boolean;
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

export interface MessagePreview {
  id: string;
  senderId: string;
  /** Start of the body; empty when deleted. */
  body: string;
  deleted: boolean;
}

export interface ReactionView {
  emoji: string;
  userId: string;
}

export interface MessageView {
  id: string;
  conversationId: string;
  senderId: string;
  /** Empty when deleted. */
  body: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  replyTo: MessagePreview | null;
  reactions: ReactionView[];
  clientId: string | null;
}

export interface PresenceView {
  online: boolean;
  lastSeenAt: string | null;
}

export interface TypingEvent {
  conversationId: string;
  userId: string;
}

export interface ConversationView {
  id: string;
  /** The other participant. */
  user: ProfileView;
  lastMessage: MessageView | null;
  unreadCount: number;
  /** When the other participant last read the conversation (read receipts). */
  otherLastReadAt: string | null;
  /** Null when either side hides its presence. */
  presence: PresenceView | null;
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
