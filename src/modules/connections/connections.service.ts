import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { parseQrPayload } from '../contacts/contact-card';
import { Profile } from '../profiles/profile.entity';
import { ProfilesService } from '../profiles/profiles.service';
import { RelationshipService } from '../relationships/relationship.service';
import { User } from '../users/user.entity';
import { ConnectionView, CreateConnectionDto, PaginationQuery } from './dto/connections.dto';
import { Connection, orderedPair } from './entities/connection.entity';

/** A declined requester may ask again after this delay. */
export const DECLINE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const USER_NOT_FOUND = 'User not found';
const CONNECTION_NOT_FOUND = 'Connection not found';
const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class ConnectionsService {
  constructor(
    @InjectRepository(Connection) private readonly connections: Repository<Connection>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    private readonly relationships: RelationshipService,
    private readonly profileViews: ProfilesService,
  ) {}

  /**
   * Sends a request, or accepts the other user's pending request (mutual interest).
   * Private profiles can only be reached through their QR code.
   */
  async request(viewerId: string, dto: CreateConnectionDto): Promise<ConnectionView> {
    if ((dto.userId === undefined) === (dto.qrPayload === undefined)) {
      throw new BadRequestException('Provide either userId or qrPayload');
    }
    if (!(await this.profiles.existsBy({ userId: viewerId }))) {
      throw new BadRequestException('Create your profile first');
    }
    const targetId = await this.resolveTarget(viewerId, dto);
    if (targetId === viewerId) {
      throw new BadRequestException('You cannot connect with yourself');
    }

    try {
      return await this.createOrReuse(viewerId, targetId, dto.message ?? null);
    } catch (error) {
      if (
        (error as { driverError?: { code?: string } }).driverError?.code !== PG_UNIQUE_VIOLATION
      ) {
        throw error;
      }
      // Both users asked at the same time: the other row now exists, apply the rules to it.
      return this.createOrReuse(viewerId, targetId, dto.message ?? null);
    }
  }

  async accept(viewerId: string, connectionId: string): Promise<ConnectionView> {
    const connection = await this.getPendingAddressedTo(viewerId, connectionId);
    await this.connections.update(
      { id: connection.id, status: 'pending' },
      { status: 'accepted', respondedAt: new Date() },
    );
    return this.view(viewerId, connection.id);
  }

  async decline(viewerId: string, connectionId: string): Promise<void> {
    const connection = await this.getPendingAddressedTo(viewerId, connectionId);
    await this.connections.update(
      { id: connection.id, status: 'pending' },
      { status: 'declined', respondedAt: new Date() },
    );
  }

  /** Cancels my pending request, or removes an accepted connection. */
  async remove(viewerId: string, connectionId: string): Promise<void> {
    const connection = await this.getForParty(viewerId, connectionId);
    if (connection.status === 'declined') {
      throw new NotFoundException(CONNECTION_NOT_FOUND);
    }
    if (connection.status === 'pending' && connection.addresseeId === viewerId) {
      throw new ForbiddenException('Decline the request instead');
    }
    await this.connections.delete({ id: connection.id });
  }

  async listConnections(viewerId: string, page: PaginationQuery): Promise<ConnectionView[]> {
    const rows = await this.connections
      .createQueryBuilder('c')
      .where('(c.user_a_id = :viewerId OR c.user_b_id = :viewerId)', { viewerId })
      .andWhere(`c.status = 'accepted'`)
      .orderBy('c.responded_at', 'DESC')
      .take(page.limit)
      .skip(page.offset)
      .getMany();
    return this.views(viewerId, rows);
  }

  async listRequests(
    viewerId: string,
    direction: 'incoming' | 'outgoing',
    page: PaginationQuery,
  ): Promise<ConnectionView[]> {
    const rows = await this.connections.find({
      where:
        direction === 'incoming'
          ? { addresseeId: viewerId, status: 'pending' }
          : { requesterId: viewerId, status: 'pending' },
      order: { createdAt: 'DESC' },
      take: page.limit,
      skip: page.offset,
    });
    return this.views(viewerId, rows);
  }

  private async resolveTarget(viewerId: string, dto: CreateConnectionDto): Promise<string> {
    let target: User | null = null;
    if (dto.qrPayload !== undefined) {
      const token = parseQrPayload(dto.qrPayload);
      target = token ? await this.users.findOneBy({ qrToken: token }) : null;
    } else {
      target = await this.users.findOneBy({ id: dto.userId });
    }
    const profile = target ? await this.profiles.findOneBy({ userId: target.id }) : null;
    const reachable =
      profile !== null &&
      (dto.qrPayload !== undefined || profile.visibility !== 'private') &&
      (await this.relationships.resolve(viewerId, profile.userId)) !== 'blocked';
    if (!target || !reachable) {
      throw new NotFoundException(USER_NOT_FOUND);
    }
    return target.id;
  }

  private async createOrReuse(
    viewerId: string,
    targetId: string,
    message: string | null,
  ): Promise<ConnectionView> {
    const [userAId, userBId] = orderedPair(viewerId, targetId);
    const existing = await this.connections.findOneBy({ userAId, userBId });

    if (!existing) {
      const { identifiers } = await this.connections.insert({
        userAId,
        userBId,
        requesterId: viewerId,
        addresseeId: targetId,
        message,
      });
      return this.view(viewerId, (identifiers[0] as { id: string }).id);
    }

    if (existing.status === 'accepted') {
      throw new ConflictException('Already connected');
    }
    if (existing.status === 'pending') {
      if (existing.requesterId === viewerId) {
        throw new ConflictException('Request already sent');
      }
      return this.accept(viewerId, existing.id);
    }

    // Declined: the declined requester waits; the other side may ask at any time.
    const recentlyDeclined =
      existing.requesterId === viewerId &&
      existing.respondedAt !== null &&
      Date.now() - existing.respondedAt.getTime() < DECLINE_COOLDOWN_MS;
    if (recentlyDeclined) {
      throw new ConflictException('Request declined recently');
    }
    await this.connections.update(
      { id: existing.id },
      {
        requesterId: viewerId,
        addresseeId: targetId,
        status: 'pending',
        message,
        respondedAt: null,
        createdAt: new Date(),
      },
    );
    return this.view(viewerId, existing.id);
  }

  private async getForParty(viewerId: string, connectionId: string): Promise<Connection> {
    const connection = await this.connections.findOneBy({ id: connectionId });
    if (!connection || (connection.userAId !== viewerId && connection.userBId !== viewerId)) {
      throw new NotFoundException(CONNECTION_NOT_FOUND);
    }
    return connection;
  }

  private async getPendingAddressedTo(viewerId: string, connectionId: string): Promise<Connection> {
    const connection = await this.getForParty(viewerId, connectionId);
    if (connection.status !== 'pending') {
      throw new ConflictException('Request is no longer pending');
    }
    if (connection.addresseeId !== viewerId) {
      throw new ForbiddenException('Only the recipient can answer this request');
    }
    return connection;
  }

  private async view(viewerId: string, connectionId: string): Promise<ConnectionView> {
    const connection = await this.connections.findOneByOrFail({ id: connectionId });
    const [view] = await this.views(viewerId, [connection]);
    if (!view) {
      throw new NotFoundException(USER_NOT_FOUND);
    }
    return view;
  }

  private async views(viewerId: string, rows: Connection[]): Promise<ConnectionView[]> {
    const otherOf = (row: Connection) => (row.userAId === viewerId ? row.userBId : row.userAId);
    const profiles = await this.profileViews.viewsFor(viewerId, rows.map(otherOf));
    return rows.flatMap((row) => {
      const user = profiles.get(otherOf(row));
      return user
        ? [
            {
              id: row.id,
              status: row.status,
              direction:
                row.requesterId === viewerId ? ('outgoing' as const) : ('incoming' as const),
              message: row.message,
              createdAt: row.createdAt.toISOString(),
              respondedAt: row.respondedAt?.toISOString() ?? null,
              user,
            },
          ]
        : [];
    });
  }

  /** Used by blocks: a block removes any connection or request between the two users. */
  async removeBetween(first: string, second: string): Promise<void> {
    const [userAId, userBId] = orderedPair(first, second);
    await this.connections.delete({ userAId, userBId });
  }
}
