import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { MessageCipher } from '../../common/crypto/message-cipher';
import { AppConfig } from '../../config/configuration';
import { orderedPair } from '../connections/entities/connection.entity';
import { ProfilesService } from '../profiles/profiles.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RelationshipService } from '../relationships/relationship.service';
import {
  ConversationView,
  MessagePage,
  MessagesQuery,
  MessageView,
  ReadReceipt,
} from './dto/messaging.dto';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';

export const MessagingEvents = {
  messageNew: 'message:new',
  conversationRead: 'conversation:read',
} as const;

const CONVERSATION_NOT_FOUND = 'Conversation not found';

@Injectable()
export class MessagingService {
  private readonly cipher: MessageCipher;

  constructor(
    config: ConfigService,
    @InjectRepository(Conversation) private readonly conversations: Repository<Conversation>,
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    private readonly relationships: RelationshipService,
    private readonly profiles: ProfilesService,
    private readonly realtime: RealtimeService,
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
    const views: ConversationView[] = [];
    for (const row of rows) {
      const view = await this.view(viewerId, row).catch(() => null);
      if (view) {
        views.push(view);
      }
    }
    return views;
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
      messages: page.map((row) => this.toView(row)),
      nextCursor: rows.length > query.limit ? page[page.length - 1].id : null,
      otherLastReadAt: this.readMarkers(conversation, viewerId).other?.toISOString() ?? null,
    };
  }

  /** Stores the message encrypted and pushes it to both participants' devices. */
  async send(viewerId: string, conversationId: string, body: string): Promise<MessageView> {
    const conversation = await this.getForMember(viewerId, conversationId);
    const otherId = this.otherOf(conversation, viewerId);
    if (!(await this.relationships.areConnected(viewerId, otherId))) {
      throw new ForbiddenException('You can only message your connections');
    }

    const encrypted = this.cipher.encrypt(body, aad(conversationId, viewerId));
    const message = this.messages.create({
      conversationId,
      senderId: viewerId,
      ...encrypted,
    });
    await this.messages.save(message);
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

    const view: MessageView = { ...this.toView(message), body };
    this.realtime.emitToUser(otherId, MessagingEvents.messageNew, view);
    this.realtime.emitToUser(viewerId, MessagingEvents.messageNew, view);
    return view;
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

  private async view(viewerId: string, conversation: Conversation): Promise<ConversationView> {
    const otherId = this.otherOf(conversation, viewerId);
    const profile = (await this.profiles.viewsFor(viewerId, [otherId])).get(otherId);
    if (!profile) {
      throw new NotFoundException(CONVERSATION_NOT_FOUND);
    }
    const markers = this.readMarkers(conversation, viewerId);
    const last = await this.messages.findOne({
      where: { conversationId: conversation.id },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    const unreadCount = await this.messages
      .createQueryBuilder('m')
      .where('m.conversation_id = :id', { id: conversation.id })
      .andWhere('m.sender_id <> :viewerId', { viewerId })
      .andWhere(markers.mine ? 'm.created_at > :since' : 'TRUE', { since: markers.mine })
      .getCount();
    return {
      id: conversation.id,
      user: profile,
      lastMessage: last ? this.toView(last) : null,
      unreadCount,
      otherLastReadAt: markers.other?.toISOString() ?? null,
      canSend: await this.relationships.areConnected(viewerId, otherId),
      updatedAt: (conversation.lastMessageAt ?? conversation.createdAt).toISOString(),
    };
  }

  private toView(message: Message): MessageView {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      body: this.cipher.decrypt(message, aad(message.conversationId, message.senderId)),
      createdAt: message.createdAt.toISOString(),
    };
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
