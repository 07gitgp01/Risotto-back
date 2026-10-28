import { Injectable } from '@nestjs/common';
import { ConnectionsService } from '../connections/connections.service';
import { ConnectionView } from '../connections/dto/connections.dto';
import { ContactsService } from '../contacts/contacts.service';
import { ConversationView } from '../messaging/dto/messaging.dto';
import { MessagingService } from '../messaging/messaging.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProfileView } from '../profiles/profile-view';

const LATEST = 3;
const ACTIVITY = 10;

export interface ActivityItem {
  type: 'connection_request' | 'connection_accepted' | 'message';
  at: string;
  actor: ProfileView;
  /** Routing ids (connectionId, conversationId). */
  data: Record<string, string>;
}

export interface Dashboard {
  pendingRequests: { count: number; latest: ConnectionView[] };
  unreadMessages: { count: number; conversations: ConversationView[] };
  unreadNotifications: number;
  stats: { connections: number; contacts: number };
  recentActivity: ActivityItem[];
}

/** Home screen summary, in one request. */
@Injectable()
export class DashboardService {
  constructor(
    private readonly connections: ConnectionsService,
    private readonly messaging: MessagingService,
    private readonly notifications: NotificationsService,
    private readonly contacts: ContactsService,
  ) {}

  async get(userId: string): Promise<Dashboard> {
    const [counts, latestRequests, unreadTotal, conversations, notificationPage, contacts] =
      await Promise.all([
        this.connections.counts(userId),
        this.connections.listRequests(userId, 'incoming', { limit: LATEST, offset: 0 }),
        this.messaging.unreadTotal(userId),
        this.messaging.list(userId),
        this.notifications.list(userId, { limit: ACTIVITY }),
        this.contacts.list(userId),
      ]);

    const fromNotifications: ActivityItem[] = notificationPage.notifications.flatMap((n) =>
      n.actor && (n.type === 'connection_request' || n.type === 'connection_accepted')
        ? [{ type: n.type, at: n.createdAt, actor: n.actor, data: n.data }]
        : [],
    );
    const fromMessages: ActivityItem[] = conversations.flatMap((c) =>
      c.lastMessage && c.lastMessage.senderId === c.user.userId
        ? [
            {
              type: 'message' as const,
              at: c.lastMessage.createdAt,
              actor: c.user,
              data: { conversationId: c.id },
            },
          ]
        : [],
    );

    return {
      pendingRequests: { count: counts.pendingIncoming, latest: latestRequests },
      unreadMessages: {
        count: unreadTotal,
        conversations: conversations.filter((c) => c.unreadCount > 0).slice(0, LATEST),
      },
      unreadNotifications: notificationPage.unreadCount,
      stats: { connections: counts.connections, contacts: contacts.length },
      recentActivity: [...fromNotifications, ...fromMessages]
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, ACTIVITY),
    };
  }
}
