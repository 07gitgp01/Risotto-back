import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, IsNull, Repository } from 'typeorm';
import { Profile } from '../profiles/profile.entity';
import { ProfilesService } from '../profiles/profiles.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  NotificationPage,
  NotificationsQuery,
  NotificationView,
  PreferenceDto,
  PreferenceView,
} from './dto/notifications.dto';
import { DevicePlatform, DeviceToken } from './entities/device-token.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { Notification } from './entities/notification.entity';
import {
  ConnectionAcceptedEvent,
  ConnectionRequestedEvent,
  DomainEvents,
  MessageCreatedEvent,
  NOTIFICATION_TYPE_NAMES,
  NOTIFICATION_TYPES,
  NotificationType,
} from './notification-types';
import { PUSH_SENDER, PushMessage, PushSender } from './push/push-sender';

export const NotificationEvents = { created: 'notification:new' } as const;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    @InjectRepository(NotificationPreference)
    private readonly preferences: Repository<NotificationPreference>,
    @InjectRepository(DeviceToken) private readonly devices: Repository<DeviceToken>,
    @InjectRepository(Profile) private readonly profileRows: Repository<Profile>,
    private readonly profiles: ProfilesService,
    private readonly realtime: RealtimeService,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
  ) {}

  // ---- Domain events ------------------------------------------------------------------

  @OnEvent(DomainEvents.connectionRequested, { async: true, suppressErrors: true })
  async onConnectionRequested(event: ConnectionRequestedEvent): Promise<void> {
    const name = await this.displayName(event.requesterId);
    await this.notify(
      event.addresseeId,
      'connection_request',
      { actorId: event.requesterId, connectionId: event.connectionId },
      {
        title: 'Nouvelle demande de mise en relation',
        body: `${name} souhaite rejoindre votre réseau.`,
      },
    );
  }

  @OnEvent(DomainEvents.connectionAccepted, { async: true, suppressErrors: true })
  async onConnectionAccepted(event: ConnectionAcceptedEvent): Promise<void> {
    const name = await this.displayName(event.accepterId);
    await this.notify(
      event.requesterId,
      'connection_accepted',
      { actorId: event.accepterId, connectionId: event.connectionId },
      { title: 'Demande acceptée', body: `${name} a accepté votre demande.` },
    );
  }

  /** Push only. The message content is never put in the push (lock screen). */
  @OnEvent(DomainEvents.messageCreated, { async: true, suppressErrors: true })
  async onMessageCreated(event: MessageCreatedEvent): Promise<void> {
    const name = await this.displayName(event.senderId);
    await this.notify(
      event.recipientId,
      'message',
      { actorId: event.senderId, conversationId: event.conversationId },
      { title: name, body: 'Nouveau message' },
    );
  }

  /** Stores the in-app notification and/or sends the push, as the user prefers. */
  async notify(
    userId: string,
    type: NotificationType,
    data: Record<string, string>,
    push: Omit<PushMessage, 'data'>,
  ): Promise<void> {
    try {
      const preference = await this.preferenceFor(userId, type);
      if (preference.inApp && NOTIFICATION_TYPES[type].supportsInApp) {
        const notification = await this.notifications.save(
          this.notifications.create({ userId, type, data }),
        );
        const [view] = await this.views(userId, [notification]);
        if (view) {
          this.realtime.emitToUser(userId, NotificationEvents.created, view);
        }
      }
      if (preference.push) {
        await this.sendPush(userId, { ...push, data: { type, ...data } });
      }
    } catch (error) {
      // A notification failure must never break the action that triggered it.
      this.logger.error(`Notification ${type} failed: ${String(error)}`);
    }
  }

  // ---- In-app list ----------------------------------------------------------------------

  async list(userId: string, query: NotificationsQuery): Promise<NotificationPage> {
    const builder = this.notifications
      .createQueryBuilder('n')
      .where('n.user_id = :userId', { userId })
      .orderBy('n.created_at', 'DESC')
      .addOrderBy('n.id', 'DESC')
      .take(query.limit + 1);
    if (query.before) {
      const cursor = await this.notifications.findOneBy({ id: query.before, userId });
      if (!cursor) {
        throw new NotFoundException('Notification not found');
      }
      builder.andWhere(
        new Brackets((qb) =>
          qb
            .where('n.created_at < :createdAt', { createdAt: cursor.createdAt })
            .orWhere('(n.created_at = :createdAt AND n.id < :id)', {
              createdAt: cursor.createdAt,
              id: cursor.id,
            }),
        ),
      );
    }
    const rows = await builder.getMany();
    const page = rows.slice(0, query.limit);
    return {
      notifications: await this.views(userId, page),
      nextCursor: rows.length > query.limit ? page[page.length - 1].id : null,
      unreadCount: await this.unreadCount(userId),
    };
  }

  /** Unread notifications, not counting those from members blocked since. */
  async unreadCount(userId: string): Promise<number> {
    const [{ count }] = await this.notifications.query<{ count: string }[]>(
      `SELECT count(*) FROM notifications n
       WHERE n.user_id = $1 AND n.read_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM blocks b
           WHERE (b.blocker_id = $1 AND b.blocked_id::text = n.data->>'actorId')
              OR (b.blocked_id = $1 AND b.blocker_id::text = n.data->>'actorId')
         )`,
      [userId],
    );
    return Number(count);
  }

  async markRead(userId: string, id: string): Promise<void> {
    const notification = await this.notifications.findOneBy({ id, userId });
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    if (!notification.readAt) {
      await this.notifications.update({ id }, { readAt: new Date() });
    }
  }

  async markAllRead(userId: string): Promise<void> {
    await this.notifications.update({ userId, readAt: IsNull() }, { readAt: new Date() });
  }

  // ---- Preferences ----------------------------------------------------------------------

  async getPreferences(userId: string): Promise<PreferenceView[]> {
    const stored = new Map(
      (await this.preferences.findBy({ userId })).map((p) => [p.type, p] as const),
    );
    return NOTIFICATION_TYPE_NAMES.map((type) => {
      const defaults = NOTIFICATION_TYPES[type];
      const row = stored.get(type);
      return {
        type,
        inApp: defaults.supportsInApp ? (row?.inApp ?? defaults.inApp) : false,
        push: row?.push ?? defaults.push,
        supportsInApp: defaults.supportsInApp,
      };
    });
  }

  async updatePreferences(userId: string, changes: PreferenceDto[]): Promise<PreferenceView[]> {
    const current = new Map((await this.getPreferences(userId)).map((p) => [p.type, p]));
    for (const change of changes) {
      const base = current.get(change.type)!;
      await this.preferences.upsert(
        {
          userId,
          type: change.type,
          inApp: base.supportsInApp ? (change.inApp ?? base.inApp) : false,
          push: change.push ?? base.push,
        },
        ['userId', 'type'],
      );
    }
    return this.getPreferences(userId);
  }

  // ---- Devices --------------------------------------------------------------------------

  /** A token moves to the user currently signed in on the device. */
  async registerDevice(userId: string, token: string, platform: DevicePlatform): Promise<void> {
    await this.devices.upsert({ userId, token, platform, lastSeenAt: new Date() }, ['token']);
  }

  async removeDevice(userId: string, token: string): Promise<void> {
    await this.devices.delete({ userId, token });
  }

  // ---- Helpers --------------------------------------------------------------------------

  private async preferenceFor(
    userId: string,
    type: NotificationType,
  ): Promise<{ inApp: boolean; push: boolean }> {
    const row = await this.preferences.findOneBy({ userId, type });
    const defaults = NOTIFICATION_TYPES[type];
    return { inApp: row?.inApp ?? defaults.inApp, push: row?.push ?? defaults.push };
  }

  private async sendPush(userId: string, message: PushMessage): Promise<void> {
    const devices = await this.devices.findBy({ userId });
    if (devices.length === 0) {
      return;
    }
    const { invalidTokens } = await this.push.send(
      devices.map((d) => d.token),
      message,
    );
    if (invalidTokens.length > 0) {
      await this.devices.delete({ token: In(invalidTokens) });
    }
  }

  private async displayName(userId: string): Promise<string> {
    const profile = await this.profileRows.findOneBy({ userId });
    return profile ? `${profile.firstName} ${profile.lastName}` : 'Un membre';
  }

  /** Notifications whose actor is now hidden (block) are left out. */
  private async views(userId: string, rows: Notification[]): Promise<NotificationView[]> {
    const actorIds = [...new Set(rows.map((r) => r.data.actorId).filter(Boolean))];
    const actors = await this.profiles.viewsFor(userId, actorIds);
    return rows.flatMap((row) => {
      const actor = row.data.actorId ? actors.get(row.data.actorId) : undefined;
      if (row.data.actorId && !actor) {
        return [];
      }
      return [
        {
          id: row.id,
          type: row.type as NotificationType,
          actor: actor ?? null,
          data: row.data,
          readAt: row.readAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        },
      ];
    });
  }
}
