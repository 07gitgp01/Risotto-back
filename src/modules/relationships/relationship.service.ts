import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Block } from '../connections/entities/block.entity';
import { Connection, orderedPair } from '../connections/entities/connection.entity';
import { SavedContact } from '../contacts/saved-contact.entity';

/** How the viewer relates to the owner of a resource. Drives every visibility rule. */
export type Relationship = 'self' | 'connected' | 'stranger' | 'blocked';

/** Connection state of a pair, from the viewer's point of view (drives the UI buttons). */
export interface ConnectionState {
  status: 'none' | 'pending_outgoing' | 'pending_incoming' | 'connected';
  connectionId: string | null;
}

@Injectable()
export class RelationshipService {
  constructor(
    @InjectRepository(SavedContact) private readonly savedContacts: Repository<SavedContact>,
    @InjectRepository(Connection) private readonly connections: Repository<Connection>,
    @InjectRepository(Block) private readonly blocks: Repository<Block>,
  ) {}

  /** `blocked` means either user blocked the other: neither may see the other's data. */
  async resolve(viewerId: string, ownerId: string): Promise<Relationship> {
    if (viewerId === ownerId) {
      return 'self';
    }
    if (await this.isBlockedEitherWay(viewerId, ownerId)) {
      return 'blocked';
    }
    return (await this.areConnected(viewerId, ownerId)) ? 'connected' : 'stranger';
  }

  isBlockedEitherWay(first: string, second: string): Promise<boolean> {
    return this.blocks.existsBy([
      { blockerId: first, blockedId: second },
      { blockerId: second, blockedId: first },
    ]);
  }

  areConnected(first: string, second: string): Promise<boolean> {
    const [userAId, userBId] = orderedPair(first, second);
    return this.connections.existsBy({ userAId, userBId, status: 'accepted' });
  }

  async connectionState(viewerId: string, otherId: string): Promise<ConnectionState> {
    const [userAId, userBId] = orderedPair(viewerId, otherId);
    const connection = await this.connections.findOneBy({ userAId, userBId });
    if (!connection || connection.status === 'declined') {
      return { status: 'none', connectionId: null };
    }
    if (connection.status === 'accepted') {
      return { status: 'connected', connectionId: connection.id };
    }
    return {
      status: connection.requesterId === viewerId ? 'pending_outgoing' : 'pending_incoming',
      connectionId: connection.id,
    };
  }

  /** The viewer kept the owner's card after scanning their QR code. */
  hasSavedCard(viewerId: string, ownerId: string): Promise<boolean> {
    return this.savedContacts.existsBy({ ownerId: viewerId, contactId: ownerId });
  }

  /** `resolve()` for many users at once: two queries whatever the list size. */
  async resolveMany(viewerId: string, otherIds: string[]): Promise<Map<string, Relationship>> {
    const result = new Map<string, Relationship>();
    const others = [...new Set(otherIds)].filter((id) => id !== viewerId);
    if (otherIds.includes(viewerId)) {
      result.set(viewerId, 'self');
    }
    if (others.length === 0) {
      return result;
    }
    const [blocked, connections] = await Promise.all([
      this.blockedUserIds(viewerId),
      this.connections.find({
        where: [
          { userAId: viewerId, userBId: In(others), status: 'accepted' },
          { userBId: viewerId, userAId: In(others), status: 'accepted' },
        ],
      }),
    ]);
    const blockedSet = new Set(blocked);
    const connected = new Set(
      connections.map((c) => (c.userAId === viewerId ? c.userBId : c.userAId)),
    );
    for (const id of others) {
      result.set(id, blockedSet.has(id) ? 'blocked' : connected.has(id) ? 'connected' : 'stranger');
    }
    return result;
  }

  /** `connectionState()` for many users at once (one query). */
  async connectionStates(
    viewerId: string,
    otherIds: string[],
  ): Promise<Map<string, ConnectionState>> {
    const states = new Map<string, ConnectionState>(
      otherIds.map((id) => [id, { status: 'none', connectionId: null }]),
    );
    if (otherIds.length === 0) {
      return states;
    }
    const rows = await this.connections.find({
      where: [
        { userAId: viewerId, userBId: In(otherIds) },
        { userBId: viewerId, userAId: In(otherIds) },
      ],
    });
    for (const row of rows) {
      const otherId = row.userAId === viewerId ? row.userBId : row.userAId;
      if (row.status === 'accepted') {
        states.set(otherId, { status: 'connected', connectionId: row.id });
      } else if (row.status === 'pending') {
        states.set(otherId, {
          status: row.requesterId === viewerId ? 'pending_outgoing' : 'pending_incoming',
          connectionId: row.id,
        });
      }
    }
    return states;
  }

  /** Users blocked by, or blocking, `userId` (to filter lists and search). */
  async blockedUserIds(userId: string): Promise<string[]> {
    const rows = await this.blocks.find({
      where: [{ blockerId: userId }, { blockedId: userId }],
    });
    return rows.map((row) => (row.blockerId === userId ? row.blockedId : row.blockerId));
  }
}
