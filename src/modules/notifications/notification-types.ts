/** Every notification type, with its defaults and the channels it can use. */
export const NOTIFICATION_TYPES = {
  connection_request: { inApp: true, push: true, supportsInApp: true },
  connection_accepted: { inApp: true, push: true, supportsInApp: true },
  // New messages already have unread badges: push only, no entry in the list.
  message: { inApp: false, push: true, supportsInApp: false },
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export const NOTIFICATION_TYPE_NAMES = Object.keys(NOTIFICATION_TYPES) as NotificationType[];

/** Domain events emitted by other modules (EventEmitter2). */
export const DomainEvents = {
  connectionRequested: 'connection.requested',
  connectionAccepted: 'connection.accepted',
  messageCreated: 'message.created',
} as const;

export interface ConnectionRequestedEvent {
  connectionId: string;
  requesterId: string;
  addresseeId: string;
}

export interface ConnectionAcceptedEvent {
  connectionId: string;
  requesterId: string;
  accepterId: string;
}

export interface MessageCreatedEvent {
  conversationId: string;
  messageId: string;
  senderId: string;
  recipientId: string;
}
