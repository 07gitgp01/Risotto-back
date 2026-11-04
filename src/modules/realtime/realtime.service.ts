import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

export const userRoom = (userId: string) => `user:${userId}`;

/** Socket lifecycle, emitted on EventEmitter2 (presence listens to them). */
export const RealtimeEvents = {
  connected: 'realtime.connected',
  heartbeat: 'realtime.heartbeat',
  disconnected: 'realtime.disconnected',
} as const;

export interface SocketLifecycleEvent {
  userId: string;
}

export interface SocketDisconnectedEvent extends SocketLifecycleEvent {
  /** Sockets of this user still open (other devices, other instances). */
  remaining: number;
}

/**
 * Pushes events to every socket of a user (all devices). Works across API instances
 * thanks to the Redis adapter. Silently does nothing before the gateway is ready.
 */
@Injectable()
export class RealtimeService {
  private server: Server | null = null;

  attach(server: Server): void {
    this.server = server;
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server?.to(userRoom(userId)).emit(event, payload);
  }

  /** Number of open sockets of a user, across API instances. */
  async socketCount(userId: string, excludingSocketId?: string): Promise<number> {
    if (!this.server) {
      return 0;
    }
    const sockets = await this.server.in(userRoom(userId)).fetchSockets();
    return sockets.filter((socket) => socket.id !== excludingSocketId).length;
  }

  /** Disconnects every socket of a user (logout everywhere, block...). */
  disconnectUser(userId: string): void {
    this.server?.in(userRoom(userId)).disconnectSockets(true);
  }
}
