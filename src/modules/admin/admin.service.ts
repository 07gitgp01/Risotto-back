import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { escapeLike } from '../connections/search.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TokensService } from '../auth/tokens.service';
import { User } from '../users/user.entity';
import { AdminAccountPage, AdminStats, ListAccountsQuery } from './dto/admin.dto';

interface AccountRow {
  id: string;
  email: string;
  role: User['role'];
  first_name: string | null;
  last_name: string | null;
  created_at: Date;
  suspended_at: Date | null;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly tokens: TokensService,
    private readonly realtime: RealtimeService,
  ) {}

  async stats(): Promise<AdminStats> {
    const [row] = await this.dataSource.query<Record<string, string>[]>(`
      SELECT
        (SELECT count(*) FROM users) AS members,
        (SELECT count(*) FROM users WHERE suspended_at IS NOT NULL) AS suspended,
        (SELECT count(*) FROM users WHERE created_at > now() - interval '7 days') AS new_members,
        (SELECT count(*) FROM profiles) AS with_profile,
        (SELECT count(*) FROM connections WHERE status = 'accepted') AS accepted,
        (SELECT count(*) FROM connections WHERE status = 'pending') AS pending,
        (SELECT count(*) FROM conversations) AS conversations,
        (SELECT count(*) FROM messages WHERE created_at > now() - interval '7 days') AS messages
    `);
    const n = (key: string) => Number(row[key]);
    return {
      members: {
        total: n('members'),
        suspended: n('suspended'),
        newLast7Days: n('new_members'),
        withProfile: n('with_profile'),
      },
      connections: { accepted: n('accepted'), pending: n('pending') },
      messaging: { conversations: n('conversations'), messagesLast7Days: n('messages') },
    };
  }

  /** Newest accounts first. Never returns message contents or private profile fields. */
  async listAccounts(query: ListAccountsQuery): Promise<AdminAccountPage> {
    const qb = this.users
      .createQueryBuilder('u')
      .leftJoin('profiles', 'p', 'p.user_id = u.id')
      .select([
        'u.id AS id',
        'u.email AS email',
        'u.role AS role',
        'p.first_name AS first_name',
        'p.last_name AS last_name',
        'u.created_at AS created_at',
        'u.suspended_at AS suspended_at',
      ]);
    if (query.q) {
      qb.andWhere(
        `(unaccent(lower(u.email::text)) LIKE '%' || unaccent(lower(:term)) || '%'
          OR unaccent(lower(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')))
             LIKE '%' || unaccent(lower(:term)) || '%')`,
        { term: escapeLike(query.q) },
      );
    }
    if (query.status === 'suspended') {
      qb.andWhere('u.suspended_at IS NOT NULL');
    } else if (query.status === 'active') {
      qb.andWhere('u.suspended_at IS NULL');
    }
    const total = await qb.clone().getCount();
    const rows = await qb
      .orderBy('u.created_at', 'DESC')
      .addOrderBy('u.id', 'ASC')
      .limit(query.limit)
      .offset(query.offset)
      .getRawMany<AccountRow>();
    return {
      total,
      items: rows.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        name: row.first_name ? `${row.first_name} ${row.last_name ?? ''}`.trim() : null,
        createdAt: row.created_at.toISOString(),
        suspendedAt: row.suspended_at?.toISOString() ?? null,
      })),
    };
  }

  /** Blocks sign-in, ends every session and closes the member's sockets. */
  async suspend(adminId: string, userId: string): Promise<void> {
    const target = await this.getTarget(userId);
    if (target.id === adminId) {
      throw new BadRequestException('You cannot suspend your own account');
    }
    if (target.role === 'admin') {
      throw new ForbiddenException('Administrators cannot be suspended');
    }
    if (!target.suspendedAt) {
      await this.users.update({ id: userId }, { suspendedAt: new Date() });
    }
    await this.tokens.revokeAllForUser(userId);
    this.realtime.disconnectUser(userId);
  }

  async reactivate(userId: string): Promise<void> {
    await this.getTarget(userId);
    await this.users.update({ id: userId }, { suspendedAt: null });
  }

  private async getTarget(userId: string): Promise<User> {
    const user = await this.users.findOneBy({ id: userId });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }
}
