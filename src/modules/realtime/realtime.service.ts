import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

export const userRoom = (userId: string) => `user:${userId}`;

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

  /** Disconnects every socket of a user (logout everywhere, block...). */
  disconnectUser(userId: string): void {
    this.server?.in(userRoom(userId)).disconnectSockets(true);
  }
}
