import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { IsNull, Repository } from 'typeorm';
import { randomToken, sha256 } from '../../common/crypto/hashing';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';
import { AppConfig } from '../../config/configuration';
import { User } from '../users/user.entity';
import { AuthTokens } from './dto/auth.dto';
import { RefreshToken } from './entities/refresh-token.entity';

export interface AccessTokenPayload {
  sub: string;
  /** Session (refresh token family): lets a logout revoke this session's access tokens. */
  sid: string;
  /** Issue time in milliseconds (`iat` is in seconds, too coarse for revocations). */
  iatMs: number;
  iat?: number;
  exp?: number;
}

const revokedSessionKey = (sid: string) => `auth:revoked-sid:${sid}`;
const validAfterKey = (userId: string) => `auth:valid-after:${userId}`;

const INVALID_REFRESH_TOKEN = 'Invalid refresh token';

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);
  private readonly authConfig: AppConfig['auth'];

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
    @InjectRepository(RefreshToken) private readonly refreshTokens: Repository<RefreshToken>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.authConfig = config.getOrThrow<AppConfig['auth']>('auth');
  }

  /** Starts a new session (token family). */
  issueForNewSession(userId: string, userAgent?: string): Promise<AuthTokens> {
    return this.issue(userId, randomUUID(), userAgent);
  }

  /**
   * Rotates a refresh token: the presented token is consumed atomically and a new one is
   * issued in the same family. Reusing a consumed or revoked token revokes the whole family.
   */
  async rotate(refreshToken: string, userAgent?: string): Promise<AuthTokens> {
    const tokenHash = sha256(refreshToken);

    const consumed = await this.refreshTokens
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ usedAt: () => 'now()' })
      .where('token_hash = :tokenHash', { tokenHash })
      .andWhere('used_at IS NULL AND revoked_at IS NULL AND expires_at > now()')
      .returning('user_id, family_id')
      .execute();

    const row = (consumed.raw as { user_id: string; family_id: string }[])[0];
    if (row) {
      return this.issue(row.user_id, row.family_id, userAgent);
    }

    const existing = await this.refreshTokens.findOneBy({ tokenHash });
    if (existing && (existing.usedAt || existing.revokedAt)) {
      this.logger.warn(`Refresh token reuse detected, revoking family ${existing.familyId}`);
      await this.revokeFamily(existing.familyId);
    }
    throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
  }

  /** Ends the session the token belongs to, only if it belongs to `userId`. */
  async revokeSession(userId: string, refreshToken: string): Promise<void> {
    const token = await this.refreshTokens.findOneBy({ tokenHash: sha256(refreshToken), userId });
    if (token) {
      await this.revokeFamily(token.familyId);
    }
  }

  /** Every session of the user, refresh and access tokens alike. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshTokens.update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
    await this.revokeAccessTokensIssuedBefore(userId, new Date());
  }

  /** Refuses access tokens issued before `instant` (logout everywhere, password change). */
  async revokeAccessTokensIssuedBefore(userId: string, instant: Date): Promise<void> {
    await this.users.update({ id: userId }, { tokensValidAfter: instant });
    await this.redis.set(
      validAfterKey(userId),
      String(instant.getTime()),
      'EX',
      this.authConfig.jwtAccessTtlSeconds,
    );
  }

  /**
   * Access tokens are short-lived but still checked against revocations, so a logout,
   * a password change or a stolen refresh token takes effect at once. Redis caches
   * the per-user marker; the database stays the source of truth.
   */
  async isAccessTokenRevoked(payload: AccessTokenPayload): Promise<boolean> {
    if (await this.redis.exists(revokedSessionKey(payload.sid))) {
      return true;
    }
    let validAfter = await this.redis.get(validAfterKey(payload.sub));
    if (validAfter === null) {
      const user = await this.users
        .createQueryBuilder('user')
        .addSelect('user.tokensValidAfter')
        .where('user.id = :id', { id: payload.sub })
        .getOne();
      if (!user) {
        return true;
      }
      validAfter = String(user.tokensValidAfter?.getTime() ?? 0);
      await this.redis.set(
        validAfterKey(payload.sub),
        validAfter,
        'EX',
        this.authConfig.jwtAccessTtlSeconds,
      );
    }
    return (payload.iatMs ?? 0) <= Number(validAfter);
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    return this.jwt.verify<AccessTokenPayload>(token, { algorithms: ['HS256'] });
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.refreshTokens.update({ familyId, revokedAt: IsNull() }, { revokedAt: new Date() });
    // Access tokens of the session live at most this long: the marker can expire with them.
    await this.redis.set(
      revokedSessionKey(familyId),
      '1',
      'EX',
      this.authConfig.jwtAccessTtlSeconds,
    );
  }

  private async issue(userId: string, familyId: string, userAgent?: string): Promise<AuthTokens> {
    const refreshToken = randomToken(32);
    const ttlMs = this.authConfig.refreshTokenTtlDays * 24 * 60 * 60 * 1000;

    await this.refreshTokens.insert({
      userId,
      familyId,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + ttlMs),
      userAgent: userAgent?.slice(0, 255) ?? null,
    });

    const payload: AccessTokenPayload = { sub: userId, sid: familyId, iatMs: Date.now() };
    return {
      accessToken: await this.jwt.signAsync(payload),
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.authConfig.jwtAccessTtlSeconds,
    };
  }
}
