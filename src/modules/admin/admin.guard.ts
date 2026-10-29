import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthenticatedRequest } from '../../common/auth/auth.decorators';
import { User } from '../users/user.entity';

/**
 * Runs after the global JWT guard. The role is read from the database on every request
 * (never from the token), so removing the role takes effect at once.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const account = await this.users.findOne({
      where: { id: user.id },
      select: { id: true, role: true, suspendedAt: true },
    });
    if (account?.role !== 'admin' || account.suspendedAt) {
      throw new ForbiddenException();
    }
    return true;
  }
}
