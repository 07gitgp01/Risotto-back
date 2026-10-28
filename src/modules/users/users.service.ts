import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import { User } from './user.entity';

const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string } | undefined)?.code === PG_UNIQUE_VIOLATION
  );
}

export interface UserView {
  id: string;
  email: string;
  createdAt: string;
}

export function toUserView(user: User): UserView {
  return { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() };
}

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  findById(id: string): Promise<User | null> {
    return this.users.findOneBy({ id });
  }

  async getById(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  findByIds(ids: string[]): Promise<User[]> {
    return ids.length === 0 ? Promise.resolve([]) : this.users.findBy({ id: In(ids) });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.users.findOneBy({ email });
  }

  /** Throws ConflictException when the email is already registered. */
  async create(email: string, passwordHash: string): Promise<User> {
    try {
      const { identifiers } = await this.users.insert({ email, passwordHash });
      return await this.getById((identifiers[0] as { id: string }).id);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Email already registered');
      }
      throw error;
    }
  }

  /** Includes the password hash, which is never selected by default. */
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();
  }
}
