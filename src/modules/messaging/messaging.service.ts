import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, QueryFailedError, Repository } from 'typeorm';
import { MessageCipher } from '../../common/crypto/message-cipher';
import { AppConfig } from '../../config/configuration';
import { orderedPair } from '../connections/entities/connection.entity';
import { DomainEvents, MessageCreatedEvent } from '../notifications/notification-types';
import { ProfilesService } from '../profiles/profiles.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RelationshipService } from '../relationships/relationship.service';
import {
  ConversationView,
  MessagePage,
  MessagePreview,
  MessagesQuery,
  MessageView,
  ReadReceipt,
  TypingEvent,
} from './dto/messaging.dto';
import { Conversation } from './entities/conversation.entity';
import { MessageReaction } from './entities/message-reaction.entity';
import { Message } from './entities/message.entity';
import { PresenceService } from './presence.service';

export const MessagingEvents = {
  messageNew: 'message:new',
  /** Edited, deleted or reacted to: the full new view. */
  messageUpdated: 'message:updated',
  conversationRead: 'conversation:read',
  typing: 'typing',
} as const;

const CONVERSATION_NOT_FOUND = 'Conversation not found';
const MESSAGE_NOT_FOUND = 'Message not found';
/** Like WhatsApp: a typo can be fixed, a conversation cannot be rewritten later. */
export const EDIT_WINDOW_MS = 15 * 60_000;
const REPLY_PREVIEW_LENGTH = 200;

export interface SendMessageInput {
  body: string;
  replyToId?: string;
  clientId?: string;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string } | undefined)?.code === '23505'
  );
}

@Injectable()
export class MessagingService {
  private readonly cipher: MessageCipher;

  constructor(
    config: ConfigService,
    @InjectRepository(Conversation) private readonly conversations: Repository<Conversation>,
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    @InjectRepository(MessageReaction) private readonly reactions: Repository<MessageReaction>,
    private readonly presence: PresenceService,
    private readonly relationships: RelationshipService,
    private readonly profiles: ProfilesService,
    private readonly realtime: RealtimeService,
    private readonly events: EventEmitter2,
  ) {
    this.cipher = new MessageCipher(
      config.getOrThrow<AppConfig['messaging']>('messaging').encryptionKey,
    );
  }

  /** Opens (or reuses) the conversation with a connection. */
  async start(viewerId: string, otherId: string): Promise<ConversationView> {
    if (otherId === viewerId || !(await this.relationships.areConnected(viewerId, otherId))) {
      throw new ForbiddenException('You can only message your connections');
    }
    const [userAId, userBId] = orderedPair(viewerId, otherId);
    await this.conversations
      .createQueryBuilder()
      .insert()
      .into(Conversation)
      .values({ userAId, userBId })
      .orIgnore()
      .execute();
    const conversation = await this.conversations.findOneByOrFail({ userAId, userBId });
    return this.view(viewerId, conversation);
  }

  async list(viewerId: string): Promise<ConversationView[]> {
    const rows = await this.conversations
      .createQueryBuilder('c')
      .where('(c.user_a_id = :viewerId OR c.user_b_id = :viewerId)', { viewerId })
      .orderBy('c.last_message_at', 'DESC', 'NULLS LAST')
      .addOrderBy('c.created_at', 'DESC')
      .take(200)
      .getMany();
    return this.views(viewerId, rows);
  }

  async get(viewerId: string, conversationId: string): Promise<ConversationView> {
    return this.view(viewerId, await this.getForMember(viewerId, conversationId));
  }

  async history(
    viewerId: string,
    conversationId: string,
    query: MessagesQuery,
  ): Promise<MessagePage> {
    const conversation = await this.getForMember(viewerId, conversationId);
    const builder = this.messages
      .createQueryBuilder('m')
      .where('m.conversation_id = :conversationId', { conversationId })
      .orderBy('m.created_at', 'DESC')
      .addOrderBy('m.id', 'DESC')
      .take(query.limit + 1);

    if (query.before) {
      const cursor = await this.messages.findOneBy({ id: query.before, conversationId });
      if (!cursor) {
        throw new NotFoundException('Message not found');
      }
      builder.andWhere(
        new Brackets((qb) =>
          qb
            .where('m.created_at < :createdAt', { createdAt: cursor.createdAt })
            .orWhere('(m.created_at = :createdAt AND m.id < :id)', {
              createdAt: cursor.createdAt,
              id: cursor.id,
            }),
        ),
      );
    }

    const rows = await builder.getMany();
    const page = rows.slice(0, query.limit);
    return {
      messages: await this.toViews(page),
      nextCursor: rows.length > query.limit ? page[page.length - 1].id : null,
      otherLastReadAt: this.readMarkers(conversation, viewerId).other?.toISOString() ?? null,
    };
  }

  /**
   * Stores the message encrypted and pushes it to both participants' devices.
   * Idempotent per `clientId`: a retry after a lost response returns the same message.
   */
  async send(
    viewerId: string,
    conversationId: string,
    input: SendMessageInput,
  ): Promise<MessageView> {
    const conversation = await this.getForMember(viewerId, conversationId);
    const already = await this.findByClientId(viewerId, conversationId, input.clientId);
    if (already) {
      return already;
    }
    const otherId = this.otherOf(conversation, viewerId);
    if (!(await this.relationships.areConnected(viewerId, otherId))) {
      throw new ForbiddenException('You can only message your connections');
    }
    if (
      input.replyToId &&
      !(await this.messages.existsBy({ id: input.replyToId, conversationId }))
    ) {
      throw new BadRequestException('replyToId must be a message of this conversation');
    }

    const message = this.messages.create({
      conversationId,
      senderId: viewerId,
      clientId: input.clientId ?? null,
      replyToId: input.replyToId ?? null,
      editedAt: null,
      deletedAt: null,
      ...this.cipher.encrypt(input.body, aad(conversationId, viewerId)),
    });
    try {
      await this.messages.save(message);
    } catch (error) {
      // Two concurrent retries: the other one won.
      const winner = isUniqueViolation(error)
        ? await this.findByClientId(viewerId, conversationId, input.clientId)
        : null;
      if (winner) {
        return winner;
      }
      throw error;
    }
    await this.conversations.update(
      { id: conversationId },
      {
        lastMessageAt: message.createdAt,
        // Sending implies having read everything before.
        ...(conversation.userAId === viewerId
          ? { userALastReadAt: message.createdAt }
          : { userBLastReadAt: message.createdAt }),
      },
    );

    const [view] = await this.toViews([message]);
    this.realtime.emitToUser(otherId, MessagingEvents.messageNew, view);
    this.realtime.emitToUser(viewerId, MessagingEvents.messageNew, view);
    this.events.emit(DomainEvents.messageCreated, {
      conversationId,
      messageId: message.id,
      senderId: viewerId,
      recipientId: otherId,
    } satisfies MessageCreatedEvent);
    return view;
  }

  /** The sender fixes a message during the first minutes. */
  async edit(
    viewerId: string,
    conversationId: string,
    messageId: string,
    body: string,
  ): Promise<MessageView> {
    const conversation = await this.getForMember(viewerId, conversationId);
    const message = await this.ownMessage(viewerId, conversationId, messageId);
    if (Date.now() - message.createdAt.getTime() > EDIT_WINDOW_MS) {
      throw new ForbiddenException('Messages can only be edited for 15 minutes');
    }
    if (!(await this.relationships.areConnected(viewerId, this.otherOf(conversation, viewerId)))) {
      throw new ForbiddenException('You can only message your connections');
    }
    Object.assign(message, this.cipher.encrypt(body, aad(conversationId, viewerId)), {
      editedAt: new Date(),
    });
    await this.messages.save(message);
    return this.broadcastUpdate(conversation, message);
  }

  /** Deleted for everyone: the encrypted body is wiped, not just hidden. */
  async remove(viewerId: string, conversationId: string, messageId: string): Promise<MessageView> {
    const conversation = await this.getForMember(viewerId, conversationId);
    const message = await this.ownMessage(viewerId, conversationId, messageId);
    Object.assign(message, {
      ciphertext: Buffer.alloc(0),
      iv: Buffer.alloc(0),
      authTag: Buffer.alloc(0),
      deletedAt: new Date(),
    });
    await this.messages.save(message);
    await this.reactions.delete({ messageId });
    return this.broadcastUpdate(conversation, message);
  }

  /** Sets (or, with null, removes) the viewer's reaction to a message. */
  async react(
    viewerId: string,
    conversationId: string,
    messageId: string,
    emoji: string | null,
  ): Promise<MessageView> {
    const conversation = await this.getForMember(viewerId, conversationId);
    const message = await this.messages.findOneBy({ id: messageId, conversationId });
    if (!message) {
      throw new NotFoundException(MESSAGE_NOT_FOUND);
    }
    if (message.deletedAt) {
      throw new ConflictException('Message deleted');
    }
    if (emoji) {
      await this.reactions.upsert({ messageId, userId: viewerId, emoji }, ['messageId', 'userId']);
    } else {
      await this.reactions.delete({ messageId, userId: viewerId });
    }
    return this.broadcastUpdate(conversation, message);
  }

  /** "En train d'écrire…", sent to the other participant only. */
  async typing(viewerId: string, conversationId: string): Promise<TypingEvent> {
    const conversation = await this.getForMember(viewerId, conversationId);
    const event: TypingEvent = { conversationId, userId: viewerId };
    this.realtime.emitToUser(this.otherOf(conversation, viewerId), MessagingEvents.typing, event);
    return event;
  }

  /** Marks everything as read and tells the other participant (read receipt). */
  async markRead(viewerId: string, conversationId: string): Promise<ReadReceipt> {
    const conversation = await this.getForMember(viewerId, conversationId);
    const readAt = new Date();
    await this.conversations.update(
      { id: conversationId },
      conversation.userAId === viewerId ? { userALastReadAt: readAt } : { userBLastReadAt: readAt },
    );
    const receipt: ReadReceipt = {
      conversationId,
      userId: viewerId,
      readAt: readAt.toISOString(),
    };
    this.realtime.emitToUser(
      this.otherOf(conversation, viewerId),
      MessagingEvents.conversationRead,
      receipt,
    );
    this.realtime.emitToUser(viewerId, MessagingEvents.conversationRead, receipt);
    return receipt;
  }

  /** Total unread messages across conversations (dashboard, badges). */
  async unreadTotal(viewerId: string): Promise<number> {
    const [{ count }] = await this.messages.query<{ count: string }[]>(
      `SELECT count(*) FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE (c.user_a_id = $1 OR c.user_b_id = $1)
         AND m.sender_id <> $1
         AND NOT EXISTS (
           SELECT 1 FROM blocks b
           WHERE (b.blocker_id = c.user_a_id AND b.blocked_id = c.user_b_id)
              OR (b.blocker_id = c.user_b_id AND b.blocked_id = c.user_a_id)
         )
         AND m.created_at > COALESCE(
           CASE WHEN c.user_a_id = $1 THEN c.user_a_last_read_at ELSE c.user_b_last_read_at END,
           '-infinity'::timestamptz
         )`,
      [viewerId],
    );
    return Number(count);
  }

  /** Members only; a block hides the conversation from both sides (404, nothing leaks). */
  private async getForMember(viewerId: string, conversationId: string): Promise<Conversation> {
    const conversation = await this.conversations.findOneBy({ id: conversationId });
    if (
      !conversation ||
      (conversation.userAId !== viewerId && conversation.userBId !== viewerId) ||
      (await this.relationships.isBlockedEitherWay(conversation.userAId, conversation.userBId))
    ) {
      throw new NotFoundException(CONVERSATION_NOT_FOUND);
    }
    return conversation;
  }

  private async findByClientId(
    viewerId: string,
    conversationId: string,
    clientId: string | undefined,
  ): Promise<MessageView | null> {
    if (!clientId) {
      return null;
    }
    const existing = await this.messages.findOneBy({ senderId: viewerId, clientId });
    if (!existing) {
      return null;
    }
    if (existing.conversationId !== conversationId) {
      throw new ConflictException('clientId already used');
    }
    const [view] = await this.toViews([existing]);
    return view;
  }

  /** A message of the viewer, still there (edit, delete). */
  private async ownMessage(
    viewerId: string,
    conversationId: string,
    messageId: string,
  ): Promise<Message> {
    const message = await this.messages.findOneBy({ id: messageId, conversationId });
    if (!message) {
      throw new NotFoundException(MESSAGE_NOT_FOUND);
    }
    if (message.senderId !== viewerId) {
      throw new ForbiddenException('Only the sender can change a message');
    }
    if (message.deletedAt) {
      throw new ConflictException('Message deleted');
    }
    return message;
  }

  private async broadcastUpdate(
    conversation: Conversation,
    message: Message,
  ): Promise<MessageView> {
    const [view] = await this.toViews([message]);
    for (const userId of [conversation.userAId, conversation.userBId]) {
      this.realtime.emitToUser(userId, MessagingEvents.messageUpdated, view);
    }
    return view;
  }

  private async view(viewerId: string, conversation: Conversation): Promise<ConversationView> {
    const [view] = await this.views(viewerId, [conversation]);
    if (!view) {
      throw new NotFoundException(CONVERSATION_NOT_FOUND);
    }
    return view;
  }

  /**
   * Views of many conversations in a constant number of queries (profiles, relationships,
   * last messages, unread counts). Conversations with a blocked member are left out.
   */
  private async views(
    viewerId: string,
    conversations: Conversation[],
  ): Promise<ConversationView[]> {
    if (conversations.length === 0) {
      return [];
    }
    const ids = conversations.map((c) => c.id);
    const otherIds = conversations.map((c) => this.otherOf(c, viewerId));

    const [relationships, profiles, lastMessages, unreadRows, presence] = await Promise.all([
      this.relationships.resolveMany(viewerId, otherIds),
      this.profiles.viewsFor(viewerId, otherIds),
      this.messages
        .createQueryBuilder('m')
        .distinctOn(['m.conversation_id'])
        .where('m.conversation_id IN (:...ids)', { ids })
        .orderBy('m.conversation_id')
        .addOrderBy('m.created_at', 'DESC')
        .addOrderBy('m.id', 'DESC')
        .getMany(),
      this.messages.query<{ id: string; count: string }[]>(
        `SELECT m.conversation_id AS id, count(*) AS count
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE m.conversation_id = ANY($2::uuid[])
           AND m.sender_id <> $1
           AND m.created_at > COALESCE(
             CASE WHEN c.user_a_id = $1 THEN c.user_a_last_read_at ELSE c.user_b_last_read_at END,
             '-infinity'::timestamptz
           )
         GROUP BY m.conversation_id`,
        [viewerId, ids],
      ),
      this.presence.viewsFor(viewerId, otherIds),
    ]);
    const lastByConversation = new Map(
      (await this.toViews(lastMessages)).map((m) => [m.conversationId, m]),
    );
    const unread = new Map(unreadRows.map((row) => [row.id, Number(row.count)]));

    return conversations.flatMap((conversation) => {
      const otherId = this.otherOf(conversation, viewerId);
      const profile = profiles.get(otherId);
      const relationship = relationships.get(otherId);
      if (!profile || relationship === 'blocked') {
        return [];
      }
      const last = lastByConversation.get(conversation.id);
      return [
        {
          id: conversation.id,
          user: profile,
          lastMessage: last ?? null,
          unreadCount: unread.get(conversation.id) ?? 0,
          otherLastReadAt: this.readMarkers(conversation, viewerId).other?.toISOString() ?? null,
          presence: presence.get(otherId) ?? null,
          canSend: relationship === 'connected',
          updatedAt: (conversation.lastMessageAt ?? conversation.createdAt).toISOString(),
        },
      ];
    });
  }

  /** Views with reply previews and reactions, in two queries for the whole batch. */
  private async toViews(messages: Message[]): Promise<MessageView[]> {
    if (messages.length === 0) {
      return [];
    }
    const replyIds = [
      ...new Set(messages.map((m) => m.replyToId).filter((id): id is string => id !== null)),
    ];
    const [reactions, replies] = await Promise.all([
      this.reactions.find({
        where: { messageId: In(messages.map((m) => m.id)) },
        order: { createdAt: 'ASC' },
      }),
      replyIds.length > 0 ? this.messages.findBy({ id: In(replyIds) }) : Promise.resolve([]),
    ]);
    const repliesById = new Map(replies.map((reply) => [reply.id, reply]));

    return messages.map((message) => {
      const replyTo = message.replyToId ? repliesById.get(message.replyToId) : undefined;
      return {
        id: message.id,
        conversationId: message.conversationId,
        senderId: message.senderId,
        body: this.bodyOf(message),
        createdAt: message.createdAt.toISOString(),
        editedAt: message.editedAt?.toISOString() ?? null,
        deleted: message.deletedAt !== null,
        replyTo: replyTo ? this.preview(replyTo) : null,
        reactions: reactions
          .filter((reaction) => reaction.messageId === message.id)
          .map(({ emoji, userId }) => ({ emoji, userId })),
        clientId: message.clientId,
      };
    });
  }

  private preview(message: Message): MessagePreview {
    return {
      id: message.id,
      senderId: message.senderId,
      body: this.bodyOf(message).slice(0, REPLY_PREVIEW_LENGTH),
      deleted: message.deletedAt !== null,
    };
  }

  private bodyOf(message: Message): string {
    return message.deletedAt
      ? ''
      : this.cipher.decrypt(message, aad(message.conversationId, message.senderId));
  }

  private otherOf(conversation: Conversation, viewerId: string): string {
    return conversation.userAId === viewerId ? conversation.userBId : conversation.userAId;
  }

  private readMarkers(
    conversation: Conversation,
    viewerId: string,
  ): { mine: Date | null; other: Date | null } {
    return conversation.userAId === viewerId
      ? { mine: conversation.userALastReadAt, other: conversation.userBLastReadAt }
      : { mine: conversation.userBLastReadAt, other: conversation.userALastReadAt };
  }
}

/** Binds a ciphertext to its conversation and sender. */
function aad(conversationId: string, senderId: string): string {
  return `${conversationId}:${senderId}`;
}
