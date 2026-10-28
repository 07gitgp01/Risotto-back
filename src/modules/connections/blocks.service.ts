import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Profile } from '../profiles/profile.entity';
import { User } from '../users/user.entity';
import { ConnectionsService } from './connections.service';
import { BlockedUserView } from './dto/connections.dto';
import { Block } from './entities/block.entity';

@Injectable()
export class BlocksService {
  constructor(
    @InjectRepository(Block) private readonly blocks: Repository<Block>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    private readonly connections: ConnectionsService,
  ) {}

  /** Idempotent. Also removes any connection or pending request between the two users. */
  async block(blockerId: string, blockedId: string): Promise<void> {
    if (blockerId === blockedId) {
      throw new BadRequestException('You cannot block yourself');
    }
    if (!(await this.users.existsBy({ id: blockedId }))) {
      throw new NotFoundException('User not found');
    }
    await this.blocks
      .createQueryBuilder()
      .insert()
      .into(Block)
      .values({ blockerId, blockedId })
      .orIgnore()
      .execute();
    await this.connections.removeBetween(blockerId, blockedId);
  }

  async unblock(blockerId: string, blockedId: string): Promise<void> {
    const result = await this.blocks.delete({ blockerId, blockedId });
    if (result.affected !== 1) {
      throw new NotFoundException('Block not found');
    }
  }

  /** Only names: enough to recognise who was blocked, nothing more. */
  async list(blockerId: string): Promise<BlockedUserView[]> {
    const rows = await this.blocks.find({ where: { blockerId }, order: { createdAt: 'DESC' } });
    const profiles = await this.profiles.findBy({ userId: In(rows.map((r) => r.blockedId)) });
    const names = new Map(profiles.map((p) => [p.userId, p]));
    return rows.map((row) => ({
      userId: row.blockedId,
      firstName: names.get(row.blockedId)?.firstName ?? null,
      lastName: names.get(row.blockedId)?.lastName ?? null,
      blockedAt: row.createdAt.toISOString(),
    }));
  }
}
