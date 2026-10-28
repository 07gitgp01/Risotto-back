import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { sha256 } from '../../common/crypto/hashing';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';
import { AppConfig } from '../../config/configuration';
import { RealtimeService } from '../realtime/realtime.service';
import { toUserView, UsersService } from '../users/users.service';
import { AuthResponse, AuthTokens, LoginDto, RegisterDto } from './dto/auth.dto';
import { PasswordHasher } from './password-hasher.service';
import { TokensService } from './tokens.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokensService,
    private readonly realtime: RealtimeService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto, userAgent?: string): Promise<AuthResponse> {
    const user = await this.users.create(dto.email, await this.hasher.hash(dto.password));
    const tokens = await this.tokens.issueForNewSession(user.id, userAgent);
    return { ...tokens, user: toUserView(user) };
  }

  async login(dto: LoginDto, userAgent?: string): Promise<AuthResponse> {
    // Per-account lock, on top of the per-IP rate limit (distributed guessing).
    // Applied to unknown emails too, so it reveals nothing about existing accounts.
    const { loginMaxFailures, loginLockMinutes } =
      this.config.getOrThrow<AppConfig['auth']>('auth');
    const failuresKey = `auth:login-failures:${sha256(dto.email)}`;
    if (Number(await this.redis.get(failuresKey)) >= loginMaxFailures) {
      throw new HttpException(
        'Too many failed attempts, try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.users.findByEmailWithPassword(dto.email);
    // Same message and same work whether the email exists or not (no account enumeration).
    const valid = await this.hasher.verify(user?.passwordHash, dto.password);
    if (!user || !valid) {
      await this.redis
        .multi()
        .incr(failuresKey)
        .expire(failuresKey, loginLockMinutes * 60)
        .exec();
      throw new UnauthorizedException('Invalid email or password');
    }
    await this.redis.del(failuresKey);
    const tokens = await this.tokens.issueForNewSession(user.id, userAgent);
    return { ...tokens, user: toUserView(user) };
  }

  refresh(refreshToken: string, userAgent?: string): Promise<AuthTokens> {
    return this.tokens.rotate(refreshToken, userAgent);
  }

  logout(userId: string, refreshToken: string): Promise<void> {
    return this.tokens.revokeSession(userId, refreshToken);
  }

  /** Revokes every session and closes every open socket of the user. */
  async logoutAll(userId: string): Promise<void> {
    await this.tokens.revokeAllForUser(userId);
    this.realtime.disconnectUser(userId);
  }
}
