import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { In, Repository } from 'typeorm';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';
import {
  RealtimeEvents,
  RealtimeService,
  SocketDisconnectedEvent,
  SocketLifecycleEvent,
} from '../realtime/realtime.service';
import { RelationshipService } from '../relationships/relationship.service';
import { User } from '../users/user.entity';
import { PresenceView } from './dto/messaging.dto';
import { Conversation } from './entities/conversation.entity';

export const PRESENCE_EVENT = 'presence';

export interface PresenceEvent {
  userId: string;
  /** Null when either side hides its presence. */
  presence: PresenceView | null;
}

/** Longer than the socket heartbeat: a crashed instance's users go offline by themselves. */
const ONLINE_TTL_SECONDS = 90;
const onlineKey = (userId: string) => `presence:online:${userId}`;

/**
 * "En ligne" / "vu à 14 h 32". Online = a Redis key refreshed by every open socket;
 * last seen = users.last_seen_at. Hiding one's presence also hides the others'
 * (reciprocal, like WhatsApp). Only conversation partners are told, never blocked users.
 */
@Injectable()
export class PresenceService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Conversation) private readonly conversations: Repository<Conversation>,
    private readonly relationships: RelationshipService,
    private readonly realtime: RealtimeService,
  ) {}

  @OnEvent(RealtimeEvents.connected, { async: true, suppressErrors: true })
  async onConnected({ userId }: SocketLifecycleEvent): Promise<void> {
    const wasOffline =
      (await this.redis.set(onlineKey(userId), '1', 'EX', ONLINE_TTL_SECONDS, 'GET')) === null;
    await this.touch(userId);
    if (wasOffline) {
      await this.broadcast(userId);
    }
  }

  @OnEvent(RealtimeEvents.heartbeat, { async: true, suppressErrors: true })
  async onHeartbeat({ userId }: SocketLifecycleEvent): Promise<void> {
    await this.redis.set(onlineKey(userId), '1', 'EX', ONLINE_TTL_SECONDS);
    await this.touch(userId);
  }

  @OnEvent(RealtimeEvents.disconnected, { async: true, suppressErrors: true })
  async onDisconnected({ userId, remaining }: SocketDisconnectedEvent): Promise<void> {
    if (remaining > 0) {
      return;
    }
    await this.redis.del(onlineKey(userId));
    await this.touch(userId);
    await this.broadcast(userId);
  }

  /** Presence of each of `otherIds`, as `viewerId` may see it. */
  async viewsFor(viewerId: string, otherIds: string[]): Promise<Map<string, PresenceView | null>> {
    const result = new Map<string, PresenceView | null>();
    if (otherIds.length === 0) {
      return result;
    }
    const ids = [...new Set([viewerId, ...otherIds])];
    const [rows, online] = await Promise.all([
      this.users.find({
        where: { id: In(ids) },
        select: { id: true, lastSeenAt: true, sharePresence: true },
      }),
      this.redis.mget(otherIds.map(onlineKey)),
    ]);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const viewerShares = byId.get(viewerId)?.sharePresence ?? false;
    otherIds.forEach((otherId, index) => {
      const other = byId.get(otherId);
      result.set(
        otherId,
        viewerShares && other?.sharePresence
          ? { online: online[index] !== null, lastSeenAt: other.lastSeenAt?.toISOString() ?? null }
          : null,
      );
    });
    return result;
  }

  async getSharePresence(userId: string): Promise<boolean> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, sharePresence: true },
    });
    return user?.sharePresence ?? true;
  }

  async setSharePresence(userId: string, sharePresence: boolean): Promise<boolean> {
    await this.users.update({ id: userId }, { sharePresence });
    await this.broadcast(userId);
    return sharePresence;
  }

  private async touch(userId: string): Promise<void> {
    await this.users.update({ id: userId }, { lastSeenAt: new Date() });
  }

  /** Tells each conversation partner the user's presence, as that partner may see it. */
  private async broadcast(userId: string): Promise<void> {
    const rows = await this.conversations
      .createQueryBuilder('c')
      .select(['c.userAId', 'c.userBId'])
      .where('c.user_a_id = :userId OR c.user_b_id = :userId', { userId })
      .getMany();
    const partners = rows.map((c) => (c.userAId === userId ? c.userBId : c.userAId));
    if (partners.length === 0) {
      return;
    }
    const relationships = await this.relationships.resolveMany(userId, partners);
    for (const partnerId of partners) {
      if (relationships.get(partnerId) === 'blocked') {
        continue;
      }
      const presence = (await this.viewsFor(partnerId, [userId])).get(userId) ?? null;
      this.realtime.emitToUser(partnerId, PRESENCE_EVENT, {
        userId,
        presence,
      } satisfies PresenceEvent);
    }
  }
}
